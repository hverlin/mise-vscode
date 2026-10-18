const isLazyTable = (
	value: unknown,
): value is { version?: unknown; lazy: true } =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	(value as { lazy?: unknown }).lazy === true;

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
	if (Array.isArray(declaration)) {
		return declaration.some(
			(entry) =>
				isLazyTable(entry) && String(entry.version) === requestedVersion,
		);
	}
	return isLazyTable(declaration);
}

/** Tools reported as missing: not installed, and not installed on first use */
export function getMissingTools(tools: MiseTool[]): MiseTool[] {
	return tools.filter((tool) => !tool.installed && !tool.lazy);
}
