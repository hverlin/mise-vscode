const isLazyTable = (
	value: unknown,
): value is { version?: unknown; lazy: true } =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	(value as { lazy?: unknown }).lazy === true;

/** Version of an entry of a list of versions, a string or a table */
const entryVersion = (entry: unknown) =>
	String(
		typeof entry === "object" && entry !== null
			? (entry as { version?: unknown }).version
			: entry,
	);

/**
 * Whether a `[tools]` entry declares the requested version lazy (mise
 * 2026.9.0+): mise installs it the first time one of its commands runs, so it
 * is not installed until then. A table entry is lazy for its version, and a
 * list of versions can make only some of them lazy:
 *
 * ```toml
 * ripgrep = { version = "14", lazy = true }
 * fd = [{ version = "10", lazy = true }, "9"]
 * ```
 */
export function isLazyToolDeclaration(
	declaration: unknown,
	requestedVersion: string,
): boolean {
	if (!Array.isArray(declaration)) {
		return isLazyTable(declaration);
	}

	const matching = declaration.filter(
		(entry) => entryVersion(entry) === requestedVersion,
	);
	if (matching.length) {
		return matching.some(isLazyTable);
	}
	// mise reports the rendered version of `version = "{{ env.FD_VERSION }}"`
	return declaration.some(
		(entry) => isLazyTable(entry) && entryVersion(entry).includes("{{"),
	);
}

const TOOL_ALIASES: Record<string, string> = { nodejs: "node", golang: "go" };

/**
 * The name `mise ls` reports a `[tools]` key under: without its inline options
 * (`github:BurntSushi/ripgrep[bin=rg]`), its `core:` prefix, or an old alias.
 */
export function normalizeToolKey(key: string): string {
	const name = key.replace(/\[.*\]$/, "").replace(/^core:/, "");
	return TOOL_ALIASES[name] ?? name;
}

/** Declaration of a tool `mise ls` reports by name, in a `[tools]` table */
export function findToolDeclaration(
	configTools: Record<string, unknown>,
	name: string,
): unknown {
	if (Object.hasOwn(configTools, name)) {
		return configTools[name];
	}
	const key = Object.keys(configTools).find(
		(candidate) => normalizeToolKey(candidate) === name,
	);
	return key === undefined ? undefined : configTools[key];
}

/** Tools reported as missing: not installed, and not installed on first use */
export function getMissingTools(tools: MiseTool[]): MiseTool[] {
	return tools.filter((tool) => !tool.installed && !tool.lazy);
}
