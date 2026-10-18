/**
 * The prefixes with which `mise search` also searches a package registry
 * (mise 2026.9.13+), e.g. `npm:prettier`
 */
export const PACKAGE_REGISTRY_PREFIXES = [
	{ prefix: "npm:", registry: "npm" },
	{ prefix: "cargo:", registry: "crates.io" },
	{ prefix: "gem:", registry: "RubyGems" },
	{ prefix: "dotnet:", registry: "NuGet" },
] as const;

export type ToolSearchResult = { name: string; description: string };

/**
 * The `mise search` query for a value typed in the tool picker, when it
 * starts with the prefix of a package registry and names something after it
 */
export function getPackageRegistryQuery(value: string): string | undefined {
	const query = value.trim();
	const registry = PACKAGE_REGISTRY_PREFIXES.find(({ prefix }) =>
		query.startsWith(prefix),
	);
	if (!registry || query.length === registry.prefix.length) {
		return undefined;
	}
	return query;
}

/** The lines of `mise search --no-header`: the tool, then its description */
export function parseToolSearchResults(stdout: string): ToolSearchResult[] {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [name = "", ...description] = line.split(/\s+/);
			return { name, description: description.join(" ") };
		});
}

/**
 * Whether a tool ends with a version, e.g. `node@20` or `npm:@scope/pkg@1`.
 * The `@` of an npm scope does not start one.
 */
export function hasToolVersion(tool: string): boolean {
	return /[^:@]@[^@]+$/.test(tool.trim());
}

/** `npm:prettier` for `npm:prettier@3` */
export function withoutVersion(tool: string): string {
	return tool.trim().replace(/([^:@])@[^@]*$/, "$1");
}

/**
 * The tool typed in the picker, when it is not the name of a registry tool:
 * a `backend:name`, or a tool with its version such as `node@20`
 */
export function getTypedTool(value: string): string | undefined {
	const tool = value.trim();
	return /^[^\s:@]+:\S+$/.test(tool) || hasToolVersion(tool) ? tool : undefined;
}

/**
 * The registry tools a `backend:name` typed may be: one of their backends
 * contains it, e.g. `prettier` (`npm:prettier`) for `npm:pr`
 */
export function findRegistryMatches(
	registry: { short: string; backends: string[] }[],
	typedTool: string,
): { short: string; backend: string }[] {
	const tool = withoutVersion(typedTool).toLowerCase();
	if (!tool.includes(":")) {
		return [];
	}
	return registry.flatMap((entry) => {
		const backend = entry.backends.find((b) => b.toLowerCase().includes(tool));
		return backend ? [{ short: entry.short, backend }] : [];
	});
}
