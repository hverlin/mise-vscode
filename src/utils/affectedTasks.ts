import { getLocalTaskName } from "./taskNames";

/**
 * A task name `mise run --affected <name>` runs in every affected project
 * declaring it, with the projects that do.
 */
export type AffectedTaskChoice = {
	name: string;
	/** roots of the affected projects running the task, `""` for the root */
	projectRoots: string[];
};

/** `node:frontend#test` -> `test`, other names unchanged */
function getScriptName(name: string): string {
	const hashIndex = name.indexOf("#");
	return hashIndex === -1 ? name : name.slice(hashIndex + 1);
}

/**
 * The names to offer for `mise run --affected <name>`, from what
 * `mise run --affected --affected-json '*'` selected: `build` for
 * `//projects/frontend:build` and the `node:frontend#build` script task alike.
 * The ones running in the most projects come first.
 */
export function getAffectedTaskChoices(
	selection: MiseAffectedSelection,
): AffectedTaskChoice[] {
	const rootsById = new Map(
		selection.projects.map((project) => [project.id, project.root]),
	);

	const rootsByName = new Map<string, Set<string>>();
	for (const task of selection.tasks) {
		const name = task.name.startsWith("//")
			? getLocalTaskName(task.name)
			: getScriptName(task.name);
		if (!name) {
			continue;
		}

		const roots = rootsByName.get(name) ?? new Set<string>();
		for (const projectId of task.projects) {
			roots.add(rootsById.get(projectId) ?? projectId);
		}
		rootsByName.set(name, roots);
	}

	return [...rootsByName]
		.map(([name, roots]) => ({ name, projectRoots: [...roots].sort() }))
		.sort(
			(a, b) =>
				b.projectRoots.length - a.projectRoots.length ||
				a.name.localeCompare(b.name),
		);
}

/** `mise run` flags selecting the affected projects, before the task names */
export function buildAffectedRunFlags(base: string | undefined): string[] {
	const trimmedBase = base?.trim();
	return trimmedBase
		? ["--affected", "--affected-base", trimmedBase]
		: ["--affected"];
}

/** Project label of an affected project root */
export function formatAffectedProjectRoot(root: string): string {
	return root ? `//${root}` : "// (monorepo root)";
}

/**
 * The reason mise gives for a failed `--affected` selection, e.g.
 * `--affected requires a monorepo root configuration`, without the version and
 * `--verbose` hints mise appends to every error.
 */
export function getAffectedErrorReason(message: string): string | undefined {
	return message
		.split("\n")
		.map((line) => line.match(/mise ERROR\s+(.*)/)?.[1]?.trim())
		.find(
			(reason) =>
				reason &&
				!reason.startsWith("Version:") &&
				!reason.startsWith("Run with --verbose"),
		);
}
