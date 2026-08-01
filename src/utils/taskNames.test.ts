import { describe, expect, it } from "bun:test";
import {
	dependsPatternMatchesTask,
	findTasksMatchingDependsPattern,
	getConfigRootPaths,
	getLocalTaskName,
	getTaskDefinitionNameCandidates,
	getTaskDisplayName,
	getTaskNameParts,
	isMonorepoTaskName,
	qualifyTaskName,
	resolveTaskReference,
} from "./taskNames";

const createTask = (
	name: string,
	source: string,
	aliases: string[] = [],
): MiseTask => ({
	name,
	aliases,
	source,
	description: "",
});

const monorepoTasks = [
	createTask("//:root-task", "/repo/mise.toml"),
	createTask("//projects/frontend:build", "/repo/projects/frontend/mise.toml"),
	createTask("//projects/frontend:dev", "/repo/projects/frontend/mise.toml"),
	createTask(
		"//projects/frontend:lint",
		"/repo/projects/frontend/tasks/lint.toml",
	),
	createTask("//projects/backend:build", "/repo/projects/backend/mise.toml"),
	// toml task aliases are reported unqualified
	createTask("//projects/backend:format", "/repo/projects/backend/mise.toml", [
		"fmt",
	]),
	// package.json script tasks use a provider id and a qualified alias
	createTask("node:frontend#test", "/repo/projects/frontend/package.json", [
		"//projects/frontend:test",
	]),
];

const regularTasks = [
	createTask("build", "/repo/mise.toml"),
	createTask("docs:build", "/repo/mise.toml", ["docs"]),
	createTask("test-unit", "/repo/tasks.toml"),
];

describe("getTaskNameParts", () => {
	it("parses non-monorepo task names", () => {
		expect(getTaskNameParts("build")).toEqual({
			configRoot: null,
			localName: "build",
		});
		expect(getTaskNameParts("docs:build")).toEqual({
			configRoot: null,
			localName: "docs:build",
		});
	});

	it("parses monorepo root task names", () => {
		expect(getTaskNameParts("//:root-task")).toEqual({
			configRoot: "",
			localName: "root-task",
		});
	});

	it("parses subproject task names", () => {
		expect(getTaskNameParts("//projects/frontend:build")).toEqual({
			configRoot: "projects/frontend",
			localName: "build",
		});
	});

	it("splits on the first colon only", () => {
		expect(getTaskNameParts("//projects/frontend:docs:build")).toEqual({
			configRoot: "projects/frontend",
			localName: "docs:build",
		});
	});
});

describe("isMonorepoTaskName / getLocalTaskName", () => {
	it("detects monorepo task names", () => {
		expect(isMonorepoTaskName("//projects/frontend:build")).toBe(true);
		expect(isMonorepoTaskName("build")).toBe(false);
	});

	it("returns the local task name", () => {
		expect(getLocalTaskName("//projects/frontend:build")).toBe("build");
		expect(getLocalTaskName("build")).toBe("build");
	});
});

describe("qualifyTaskName", () => {
	it("qualifies a local name found in a subproject config", () => {
		expect(
			qualifyTaskName(
				monorepoTasks,
				"build",
				"/repo/projects/frontend/mise.toml",
			),
		).toBe("//projects/frontend:build");
		expect(
			qualifyTaskName(
				monorepoTasks,
				"build",
				"/repo/projects/backend/mise.toml",
			),
		).toBe("//projects/backend:build");
	});

	it("qualifies root tasks", () => {
		expect(qualifyTaskName(monorepoTasks, "root-task", "/repo/mise.toml")).toBe(
			"//:root-task",
		);
	});

	it("keeps non-monorepo names unchanged", () => {
		expect(qualifyTaskName(regularTasks, "build", "/repo/mise.toml")).toBe(
			"build",
		);
	});

	it("falls back to the given name when no task matches", () => {
		expect(
			qualifyTaskName(
				monorepoTasks,
				"unknown",
				"/repo/projects/frontend/mise.toml",
			),
		).toBe("unknown");
	});
});

describe("resolveTaskReference", () => {
	it("resolves fully qualified names", () => {
		expect(
			resolveTaskReference(monorepoTasks, "//projects/backend:build")?.name,
		).toBe("//projects/backend:build");
	});

	it("resolves :name relative to the config root of the document", () => {
		expect(
			resolveTaskReference(
				monorepoTasks,
				":build",
				"/repo/projects/frontend/mise.toml",
			)?.name,
		).toBe("//projects/frontend:build");
	});

	it("does not resolve :name outside of a monorepo", () => {
		expect(
			resolveTaskReference(regularTasks, ":build", "/repo/mise.toml"),
		).toBeUndefined();
	});

	it("resolves bare names to tasks in the same file first", () => {
		expect(
			resolveTaskReference(
				monorepoTasks,
				"build",
				"/repo/projects/frontend/mise.toml",
			)?.name,
		).toBe("//projects/frontend:build");
	});

	it("resolves bare names to tasks in the same config root", () => {
		expect(
			resolveTaskReference(
				monorepoTasks,
				"build",
				"/repo/projects/frontend/tasks/lint.toml",
			)?.name,
		).toBe("//projects/frontend:build");
	});

	it("resolves bare names by exact match outside of a monorepo", () => {
		expect(
			resolveTaskReference(regularTasks, "docs:build", "/repo/mise.toml")?.name,
		).toBe("docs:build");
	});

	it("resolves qualified aliases of package.json script tasks", () => {
		expect(
			resolveTaskReference(monorepoTasks, "//projects/frontend:test")?.name,
		).toBe("node:frontend#test");
	});

	it("resolves :name to a package.json script task of the same project", () => {
		expect(
			resolveTaskReference(
				monorepoTasks,
				":test",
				"/repo/projects/frontend/mise.toml",
			)?.name,
		).toBe("node:frontend#test");
	});

	it("resolves qualified names built from an unqualified alias", () => {
		expect(
			resolveTaskReference(monorepoTasks, "//projects/backend:fmt")?.name,
		).toBe("//projects/backend:format");
	});

	it("resolves unqualified aliases within the same config root", () => {
		expect(
			resolveTaskReference(
				monorepoTasks,
				"fmt",
				"/repo/projects/backend/mise.toml",
			)?.name,
		).toBe("//projects/backend:format");
	});

	it("resolves aliases outside of a monorepo", () => {
		expect(
			resolveTaskReference(regularTasks, "docs", "/repo/mise.toml")?.name,
		).toBe("docs:build");
	});
});

describe("getConfigRootPaths", () => {
	it("returns unique config roots, excluding the monorepo root", () => {
		expect(getConfigRootPaths(monorepoTasks)).toEqual([
			"projects/backend",
			"projects/frontend",
		]);
	});

	it("returns nothing outside of a monorepo", () => {
		expect(getConfigRootPaths(regularTasks)).toEqual([]);
	});
});

describe("getTaskDisplayName", () => {
	it("shows the local name of monorepo tasks", () => {
		expect(
			getTaskDisplayName(
				createTask(
					"//projects/frontend:build",
					"/repo/projects/frontend/mise.toml",
				),
			),
		).toBe("build");
	});

	it("shows the script name of package.json script tasks", () => {
		expect(
			getTaskDisplayName(
				createTask(
					"node:frontend#test",
					"/repo/projects/frontend/package.json",
					["//projects/frontend:test"],
				),
			),
		).toBe("test");
	});

	it("keeps non-monorepo names unchanged", () => {
		expect(
			getTaskDisplayName(createTask("docs:build", "/repo/mise.toml")),
		).toBe("docs:build");
	});
});

describe("getTaskDefinitionNameCandidates", () => {
	it("extracts local names from qualified names", () => {
		expect(
			getTaskDefinitionNameCandidates("//projects/frontend:build"),
		).toEqual(["build"]);
	});

	it("extracts script names from workspace task ids", () => {
		expect(getTaskDefinitionNameCandidates("node:frontend#test")).toEqual([
			"test",
			"node:frontend#test",
		]);
	});

	it("keeps plain names unchanged", () => {
		expect(getTaskDefinitionNameCandidates("build")).toEqual(["build"]);
	});
});

describe("dependsPatternMatchesTask", () => {
	const frontendBuild = createTask(
		"//projects/frontend:build",
		"/repo/projects/frontend/mise.toml",
	);
	const rootTask = createTask("//:root-task", "/repo/mise.toml");

	it("matches fully qualified patterns", () => {
		expect(
			dependsPatternMatchesTask("//projects/frontend:build", "", frontendBuild),
		).toBe(true);
		expect(
			dependsPatternMatchesTask("//projects/backend:build", "", frontendBuild),
		).toBe(false);
	});

	it("matches ... path wildcards", () => {
		expect(
			dependsPatternMatchesTask("//projects/...:build", "", frontendBuild),
		).toBe(true);
		expect(dependsPatternMatchesTask("//...:build", "", frontendBuild)).toBe(
			true,
		);
		expect(dependsPatternMatchesTask("//...:root-task", "", rootTask)).toBe(
			true,
		);
		expect(
			dependsPatternMatchesTask("//projects/...:root-task", "", rootTask),
		).toBe(false);
	});

	it("matches task name wildcards", () => {
		expect(
			dependsPatternMatchesTask("//projects/frontend:*", "", frontendBuild),
		).toBe(true);
		expect(
			dependsPatternMatchesTask("//projects/frontend:bu*", "", frontendBuild),
		).toBe(true);
	});

	it("matches :name patterns against the owner config root", () => {
		expect(
			dependsPatternMatchesTask(":build", "projects/frontend", frontendBuild),
		).toBe(true);
		expect(
			dependsPatternMatchesTask(":build", "projects/backend", frontendBuild),
		).toBe(false);
	});

	it("matches bare names against the owner config root in a monorepo", () => {
		expect(
			dependsPatternMatchesTask("build", "projects/frontend", frontendBuild),
		).toBe(true);
		expect(
			dependsPatternMatchesTask("build", "projects/backend", frontendBuild),
		).toBe(false);
	});

	it("keeps non-monorepo glob behavior", () => {
		const testTask = createTask("test-unit", "/repo/tasks.toml");
		expect(dependsPatternMatchesTask("test*", null, testTask)).toBe(true);
		expect(dependsPatternMatchesTask("lint*", null, testTask)).toBe(false);
	});

	it("ignores arguments in depends entries", () => {
		const backendBuild = createTask(
			"//projects/backend:build",
			"/repo/projects/backend/mise.toml",
		);
		expect(
			dependsPatternMatchesTask(
				"build --quick",
				"projects/backend",
				backendBuild,
			),
		).toBe(true);
	});

	it("matches unqualified aliases", () => {
		const format = createTask(
			"//projects/backend:format",
			"/repo/projects/backend/mise.toml",
			["fmt"],
		);
		expect(dependsPatternMatchesTask("fmt", "projects/backend", format)).toBe(
			true,
		);
		expect(dependsPatternMatchesTask("fmt", "projects/frontend", format)).toBe(
			false,
		);
	});

	it("matches package.json script tasks through their qualified alias", () => {
		const nodeTest = createTask(
			"node:frontend#test",
			"/repo/projects/frontend/package.json",
			["//projects/frontend:test"],
		);
		expect(
			dependsPatternMatchesTask(":test", "projects/frontend", nodeTest),
		).toBe(true);
		expect(
			dependsPatternMatchesTask("//projects/frontend:*", "", nodeTest),
		).toBe(true);
		expect(dependsPatternMatchesTask("//projects/...:test", "", nodeTest)).toBe(
			true,
		);
	});

	it("matches aliases outside of a monorepo", () => {
		const docsBuild = createTask("docs:build", "/repo/mise.toml", ["docs"]);
		expect(dependsPatternMatchesTask("docs", null, docsBuild)).toBe(true);
	});
});

describe("findTasksMatchingDependsPattern", () => {
	it("returns all tasks matching a path wildcard", () => {
		const matches = findTasksMatchingDependsPattern(
			monorepoTasks,
			"//projects/...:build",
			"/repo/mise.toml",
		);
		expect(matches.map((t) => t.name)).toEqual([
			"//projects/frontend:build",
			"//projects/backend:build",
		]);
	});

	it("returns all tasks of a project for a name wildcard", () => {
		const matches = findTasksMatchingDependsPattern(
			monorepoTasks,
			"//projects/frontend:*",
			"/repo/mise.toml",
		);
		expect(matches.map((t) => t.name)).toEqual([
			"//projects/frontend:build",
			"//projects/frontend:dev",
			"//projects/frontend:lint",
			"node:frontend#test",
		]);
	});

	it("resolves relative wildcards against the config root of the document", () => {
		const matches = findTasksMatchingDependsPattern(
			monorepoTasks,
			":build",
			"/repo/projects/backend/mise.toml",
		);
		expect(matches.map((t) => t.name)).toEqual(["//projects/backend:build"]);
	});

	it("returns a single task for plain references", () => {
		const matches = findTasksMatchingDependsPattern(
			regularTasks,
			"docs",
			"/repo/mise.toml",
		);
		expect(matches.map((t) => t.name)).toEqual(["docs:build"]);
	});
});
