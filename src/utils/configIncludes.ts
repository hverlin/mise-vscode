import os from "node:os";
import path from "node:path";
import { expandPath } from "./fileUtils";
import { getProjectRootFromConfigPath } from "./projectsUtils";

/** `git::...`, `oci::...`, or a URL: mise fetches those into its cache */
const REMOTE_INCLUDE = /^(?:[a-z][a-z0-9+.-]*::|[a-z][a-z0-9+.-]*:\/\/)/i;

const CONFIG_ROOT_TEMPLATE = /\{\{\s*config_root\s*\}\}/g;

/** `{{ config_root }}` of a config: its project, also for `conf.d` fragments */
function getConfigRoot(configPath: string): string {
	const dir = path.dirname(configPath);
	return getProjectRootFromConfigPath(
		path.basename(dir) === "conf.d" ? dir : configPath,
	);
}

/**
 * The local files a config merges with `include = [...]` (mise 2026.10.6+),
 * resolved from the directory of the config. `{{ config_root }}` is rendered,
 * other templates are left out. Included files cannot include others.
 */
export function getLocalIncludePaths(
	configPath: string,
	config: unknown,
): string[] {
	const include = (config as { include?: unknown } | undefined)?.include;
	const entries = Array.isArray(include) ? include : [include];
	return entries
		.filter(
			(entry): entry is string =>
				typeof entry === "string" &&
				entry.trim() !== "" &&
				!REMOTE_INCLUDE.test(entry),
		)
		.map((entry) =>
			entry.replace(CONFIG_ROOT_TEMPLATE, getConfigRoot(configPath)),
		)
		.filter(
			(entry) =>
				!entry.includes("{{") &&
				!entry.includes("{%") &&
				entry.endsWith(".toml"),
		)
		.map((entry) =>
			expandPath(
				path.resolve(
					path.dirname(configPath),
					entry.replace(/^~(?=\/|\\|$)/, os.homedir()),
				),
			),
		);
}

/**
 * The `include` of a config the TOML parser does not read, e.g. one using
 * TOML 1.1, which mise accepts: the quoted strings of the top-level key.
 */
export function readIncludeEntries(source: string): string[] {
	// a top-level key comes before the first table header
	const topLevel = source.split(/^\s*\[/m)[0] ?? "";
	const value = /^\s*include\s*=\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/m.exec(
		topLevel,
	)?.[1];
	return [...(value ?? "").matchAll(/"([^"]*)"|'([^']*)'/g)].map(
		(match) => match[1] ?? match[2] ?? "",
	);
}

/**
 * Every file the configs merge with `include`. mise reports their content as
 * coming from the config including them, so they are not among the files it
 * lists. `readConfig` returns the parsed file, or undefined when it cannot be
 * read.
 */
export async function collectLocalIncludes(
	configPaths: string[],
	readConfig: (filePath: string) => Promise<unknown>,
): Promise<string[]> {
	const configs = [...new Set(configPaths.map((p) => expandPath(p)))];
	const includes = await Promise.all(
		configs.map(async (configPath) =>
			getLocalIncludePaths(configPath, await readConfig(configPath)),
		),
	);
	const configSet = new Set(configs);
	return [...new Set(includes.flat())].filter(
		(include) => !configSet.has(include),
	);
}

/**
 * The miserc files mise reads before any config, which pick the environments
 * it loads (`env = [...]`): from the working directory up to the home
 * directory, then the global and the system ones.
 */
export function getMiseRcPaths({
	cwd,
	home,
	configDir,
	systemConfigDir,
	ceilingPaths = [],
}: {
	cwd: string;
	home: string;
	/** the global mise config directory, `~/.config/mise` by default */
	configDir: string;
	systemConfigDir?: string;
	ceilingPaths?: string[];
}): string[] {
	const ceilings = new Set(
		ceilingPaths.map((ceiling) => path.resolve(ceiling)),
	);
	const files: string[] = [];

	let dir = path.resolve(cwd);
	while (!ceilings.has(dir)) {
		files.push(
			path.join(dir, ".miserc.local.toml"),
			path.join(dir, ".miserc.toml"),
		);
		const parent = path.dirname(dir);
		if (dir === path.resolve(home) || parent === dir) {
			break;
		}
		files.push(path.join(dir, ".config", "miserc.toml"));
		dir = parent;
	}

	files.push(
		path.join(configDir, "miserc.local.toml"),
		path.join(configDir, "miserc.toml"),
	);
	if (systemConfigDir) {
		files.push(path.join(systemConfigDir, "miserc.toml"));
	}
	return files.map((file) => expandPath(file));
}
