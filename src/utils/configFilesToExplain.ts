import path from "node:path";

/** `git::...`, `oci::...`: mise fetches those, nothing to match on disk */
const REMOTE_ENTRY = /^[a-z][a-z0-9+.-]*::/i;

const literalEntries = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter(
				(entry): entry is string =>
					typeof entry === "string" &&
					entry.trim() !== "" &&
					!REMOTE_ENTRY.test(entry) &&
					!entry.includes("{{") &&
					!entry.includes("{%"),
			)
		: [];

/** The local, untemplated entries of `[task_config] includes` of a config */
export function getTaskIncludes(config: unknown): string[] {
	return literalEntries(
		(config as { task_config?: { includes?: unknown } } | undefined)
			?.task_config?.includes,
	);
}

/** The untemplated entries of `[monorepo] config_roots` of a config */
export function getMonorepoConfigRoots(config: unknown): string[] {
	return literalEntries(
		(config as { monorepo?: { config_roots?: unknown } } | undefined)?.monorepo
			?.config_roots,
	);
}

const hasGlob = (text: string) => /[*?[]/.test(text);

/** A glob of `/`-separated segments: `*` and `?` stay in a segment, `**` does not */
function globToRegExp(pattern: string): RegExp {
	const source = pattern
		.split("")
		.map((char, index, chars) => {
			if (char === "*") {
				if (chars[index + 1] === "*") {
					return "";
				}
				return chars[index - 1] === "*" ? ".*" : "[^/]*";
			}
			if (char === "?") {
				return "[^/]";
			}
			return char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		})
		.join("");
	return new RegExp(`^${source}$`);
}

/**
 * Whether a config root includes this file as a task file, with
 * `[task_config] includes`: the file itself, a file under an included
 * directory, or one matching an included glob. Entries are relative to the
 * config root.
 */
export function isTaskInclude(
	filePath: string,
	configRoot: string,
	includes: string[],
): boolean {
	const relative = path
		.relative(configRoot, filePath)
		.split(path.sep)
		.join("/");
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		return false;
	}
	return includes.some((entry) => {
		const included = entry
			.split(path.sep)
			.join("/")
			.replace(/^\.\//, "")
			.replace(/\/+$/, "");
		if (hasGlob(included)) {
			return globToRegExp(included).test(relative);
		}
		return relative === included || relative.startsWith(`${included}/`);
	});
}

/**
 * The directories `[monorepo] config_roots` patterns name under the root of
 * a monorepo, such as `projects/*`. A glob matches the names of a single
 * directory level.
 */
export async function expandConfigRoots(
	root: string,
	patterns: string[],
	listDirectories: (directory: string) => Promise<string[]>,
): Promise<string[]> {
	const expanded = await Promise.all(
		patterns.map(async (pattern) => {
			let directories = [root];
			for (const segment of pattern.split(/[\\/]/).filter(Boolean)) {
				if (segment === ".") {
					continue;
				}
				if (!hasGlob(segment)) {
					directories = directories.map((directory) =>
						path.join(directory, segment),
					);
					continue;
				}
				const matcher = globToRegExp(segment.replace(/\*\*/g, "*"));
				directories = (
					await Promise.all(
						directories.map(async (directory) =>
							(
								await listDirectories(directory)
							)
								.filter((name) => matcher.test(name))
								.map((name) => path.join(directory, name)),
						),
					)
				).flat();
			}
			return directories;
		}),
	);
	return [...new Set(expanded.flat())].filter(
		(directory) => directory !== root,
	);
}
