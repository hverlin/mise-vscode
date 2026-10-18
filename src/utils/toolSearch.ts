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
