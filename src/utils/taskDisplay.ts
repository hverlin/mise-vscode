import { displayPathRelativeTo } from "./fileUtils";

/** Secondary line of a task, falling back to its command when undocumented. */
export function getTaskDescription(task: MiseTask): string {
	return task.description || task.run?.join(" ") || "";
}

/**
 * Secondary line of a task in a quick pick. Flat lists have no group header to
 * locate a file task, so its script is shown when nothing else describes it.
 */
export function getTaskPickDescription(
	task: MiseTask,
	workspaceRoot?: string,
): string {
	return (
		getTaskDescription(task) ||
		(task.file ? displayPathRelativeTo(task.file, workspaceRoot) : "")
	);
}

/** Display a mise task outputs field from `mise tasks ls --json`. */
export function formatTaskOutputs(
	outputs: MiseTask["outputs"],
): string | undefined {
	if (Array.isArray(outputs)) {
		return outputs.join(", ");
	}
	return outputs?.auto ? "Auto-detected" : undefined;
}
