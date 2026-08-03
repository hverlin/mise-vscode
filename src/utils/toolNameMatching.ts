export type RegistryToolEntry = { short: string; backends: string[] };

/**
 * All the names a tool can be referred to by: the name it is declared with in
 * mise.toml, plus its mise registry equivalents (short name <-> backend
 * sources). Lets `toolSources` entries like `aqua:mvdan/sh` match a tool
 * declared as `shfmt` and vice versa.
 */
export function expandToolNames(
	toolName: string,
	registry: RegistryToolEntry[],
): Set<string> {
	const names = new Set([toolName]);

	for (const entry of registry) {
		if (entry.short === toolName) {
			for (const backend of entry.backends) {
				names.add(backend);
			}
		} else if (entry.backends.includes(toolName)) {
			names.add(entry.short);
		}
	}

	return names;
}
