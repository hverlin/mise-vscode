/** Display a mise task outputs field from `mise tasks ls --json`. */
export function formatTaskOutputs(
	outputs: MiseTask["outputs"],
): string | undefined {
	if (Array.isArray(outputs)) {
		return outputs.join(", ");
	}
	return outputs?.auto ? "Auto-detected" : undefined;
}
