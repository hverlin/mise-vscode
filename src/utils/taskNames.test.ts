import { describe, expect, it } from "bun:test";
import {
	dependsPatternMatchesTask,
	findTasksMatchingDependsPattern,
	getConfigRootPaths,
	getDependsEntryPattern,
	getLocalTaskName,
	getTaskConfigRoot,
	getTaskDefinitionNameCandidates,
	getTaskDependencyEdges,
	getTaskDisplayName,
	getTaskNameParts,
	getUpstreamConfigRoots,
	isMonorepoTaskName,
	isTaskDependency,
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

	// mise 2026.8.1: `*` stays inside one task group, `**` spans groups
	it("keeps * inside a single task group", () => {
		const unitLocal = createTask("test:unit:local", "/repo/mise.toml");
		const happyLocal = createTask("test:e2e:happy:local", "/repo/mise.toml");

		expect(dependsPatternMatchesTask("test:*:local", null, unitLocal)).toBe(
			true,
		);
		expect(dependsPatternMatchesTask("test:*:local", null, happyLocal)).toBe(
			false,
		);
		expect(dependsPatternMatchesTask("test:*", null, unitLocal)).toBe(false);
	});

	it("lets ** span task groups", () => {
		const unitLocal = createTask("test:unit:local", "/repo/mise.toml");
		const happyLocal = createTask("test:e2e:happy:local", "/repo/mise.toml");

		expect(dependsPatternMatchesTask("test:**:local", null, unitLocal)).toBe(
			true,
		);
		expect(dependsPatternMatchesTask("test:**:local", null, happyLocal)).toBe(
			true,
		);
		expect(dependsPatternMatchesTask("test:**", null, happyLocal)).toBe(true);
	});

	it("applies group boundaries to monorepo task names", () => {
		const docsBuild = createTask(
			"//projects/frontend:docs:build",
			"/repo/projects/frontend/mise.toml",
		);

		expect(
			dependsPatternMatchesTask("//projects/frontend:*", "", docsBuild),
		).toBe(false);
		expect(
			dependsPatternMatchesTask("//projects/frontend:**", "", docsBuild),
		).toBe(true);
		expect(
			dependsPatternMatchesTask("//projects/frontend:docs:*", "", docsBuild),
		).toBe(true);
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

describe("getDependsEntryPattern", () => {
	it("returns string entries as-is", () => {
		expect(getDependsEntryPattern("build")).toBe("build");
	});

	it("returns the first element of [task, ...args] entries", () => {
		expect(getDependsEntryPattern(["build", "--quick"])).toBe("build");
	});

	it("returns the task of provider-suggested object entries", () => {
		expect(
			getDependsEntryPattern({ task: "//projects/ui:build", optional: true }),
		).toBe("//projects/ui:build");
	});
});

describe("isTaskDependency", () => {
	// depends imported from turbo.json are reported as objects
	const scriptTaskWithTurboDeps = {
		...createTask(
			"node:frontend#test",
			"/repo/projects/frontend/package.json",
			["//projects/frontend:test"],
		),
		depends: [
			{ task: "//projects/backend:test", optional: true },
			// same-package turbo deps are reported as bare local names
			"start",
		],
	};
	const backendScriptTask = createTask(
		"node:backend#test",
		"/repo/projects/backend/package.json",
		["//projects/backend:test"],
	);
	// a toml task that shadows a package.json script keeps the provider name
	// as alias
	const collidingTomlTask = createTask(
		"//projects/frontend:start",
		"/repo/projects/frontend/mise.toml",
		["node:frontend#start"],
	);

	it("matches provider-suggested object entries", () => {
		expect(isTaskDependency(scriptTaskWithTurboDeps, backendScriptTask)).toBe(
			true,
		);
	});

	it("resolves bare entries of provider tasks within their own project", () => {
		expect(isTaskDependency(scriptTaskWithTurboDeps, collidingTomlTask)).toBe(
			true,
		);
	});

	it("does not match bare entries across projects", () => {
		const otherProjectTask = createTask(
			"//projects/backend:start",
			"/repo/projects/backend/mise.toml",
		);
		expect(isTaskDependency(scriptTaskWithTurboDeps, otherProjectTask)).toBe(
			false,
		);
	});

	it("matches [task, ...args] entries", () => {
		const owner = {
			...createTask(
				"//projects/backend:release",
				"/repo/projects/backend/mise.toml",
			),
			depends: [["build", "--quick"]],
		};
		const target = createTask(
			"//projects/backend:build",
			"/repo/projects/backend/mise.toml",
		);
		expect(isTaskDependency(owner, target)).toBe(true);
	});
});

describe("getUpstreamConfigRoots", () => {
	const projects: MiseProject[] = [
		{ id: "node:app", root: "packages/app", dependencies: ["node:bridge"] },
		{ id: "node:bridge", root: "packages/bridge", dependencies: ["node:core"] },
		{ id: "node:core", root: "packages/core", dependencies: [] },
		{ id: "uv:root", root: ".", dependencies: [] },
		{ id: "cargo:tool", root: "crates/tool", dependencies: ["cargo:tool"] },
	];

	it("collects transitive upstream roots", () => {
		expect(
			[...getUpstreamConfigRoots(projects, "packages/app")].sort(),
		).toEqual(["packages/bridge", "packages/core"]);
	});

	it("returns an empty set for projects without upstream projects", () => {
		expect(getUpstreamConfigRoots(projects, "packages/core").size).toBe(0);
		expect(getUpstreamConfigRoots(projects, "").size).toBe(0);
	});

	it("excludes the owner root and survives cycles", () => {
		expect(getUpstreamConfigRoots(projects, "crates/tool").size).toBe(0);
	});
});

describe("findTasksMatchingDependsPattern with ^ upstream references", () => {
	const projects: MiseProject[] = [
		{
			id: "node:frontend",
			root: "projects/frontend",
			dependencies: ["node:backend", "node:shared"],
		},
		{ id: "node:backend", root: "projects/backend", dependencies: [] },
		{ id: "node:shared", root: "projects/shared", dependencies: [] },
	];
	const tasks = [
		createTask("//projects/backend:build", "/repo/projects/backend/mise.toml"),
		// same name in the owner project must not match
		createTask(
			"//projects/frontend:build",
			"/repo/projects/frontend/mise.toml",
		),
		// not an upstream project
		createTask("//projects/other:build", "/repo/projects/other/mise.toml"),
	];

	it("matches tasks of upstream projects only", () => {
		const matches = findTasksMatchingDependsPattern(
			tasks,
			"^build",
			"/repo/projects/frontend/mise.toml",
			projects,
		);
		expect(matches.map((t) => t.name)).toEqual(["//projects/backend:build"]);
	});

	it("supports name wildcards", () => {
		const matches = findTasksMatchingDependsPattern(
			tasks,
			"^bu*",
			"/repo/projects/frontend/mise.toml",
			projects,
		);
		expect(matches.map((t) => t.name)).toEqual(["//projects/backend:build"]);
	});

	it("returns nothing without the projects graph", () => {
		const matches = findTasksMatchingDependsPattern(
			tasks,
			"^build",
			"/repo/projects/frontend/mise.toml",
		);
		expect(matches).toEqual([]);
	});
});

describe("scoped package script tasks", () => {
	const scopedTask = createTask(
		"node:@fixture/shared#lint",
		"/repo/projects/shared/package.json",
		["//projects/shared:lint"],
	);

	it("derives the config root from the qualified alias", () => {
		expect(getTaskConfigRoot(scopedTask)).toBe("projects/shared");
	});

	it("resolves the qualified alias to the scoped task", () => {
		expect(
			resolveTaskReference([scopedTask], "//projects/shared:lint")?.name,
		).toBe("node:@fixture/shared#lint");
	});
});

describe("getTaskDependencyEdges", () => {
	const projects: MiseProject[] = [
		{
			id: "node:frontend",
			root: "projects/frontend",
			dependencies: ["node:backend"],
		},
		{ id: "node:backend", root: "projects/backend", dependencies: [] },
	];

	const graphTasks = [
		{
			...createTask("//:build-all", "/repo/mise.toml"),
			depends: ["//projects/...:build"],
		},
		{
			...createTask(
				"//projects/frontend:ci",
				"/repo/projects/frontend/mise.toml",
			),
			depends: ["build", ":test"],
			wait_for: ["//projects/backend:build"],
			depends_post: [["build", "--quick"]],
		},
		{
			...createTask(
				"//projects/frontend:package",
				"/repo/projects/frontend/mise.toml",
			),
			depends: ["^build"],
		},
		createTask(
			"//projects/frontend:build",
			"/repo/projects/frontend/mise.toml",
		),
		{
			...createTask(
				"node:frontend#test",
				"/repo/projects/frontend/package.json",
				["//projects/frontend:test"],
			),
			depends: [{ task: "//projects/backend:test", optional: true }],
		},
		createTask("//projects/backend:build", "/repo/projects/backend/mise.toml"),
		{
			...createTask(
				"node:backend#test",
				"/repo/projects/backend/package.json",
				["//projects/backend:test"],
			),
		},
	];

	it("resolves every depends form into edges", () => {
		const edges = getTaskDependencyEdges(graphTasks, projects);

		expect(edges).toContainEqual({
			from: "//:build-all",
			to: "//projects/frontend:build",
			kind: "depends",
		});
		expect(edges).toContainEqual({
			from: "//:build-all",
			to: "//projects/backend:build",
			kind: "depends",
		});
		// bare name and :name resolve within the project
		expect(edges).toContainEqual({
			from: "//projects/frontend:ci",
			to: "//projects/frontend:build",
			kind: "depends",
		});
		expect(edges).toContainEqual({
			from: "//projects/frontend:ci",
			to: "node:frontend#test",
			kind: "depends",
		});
		// wait_for and depends_post keep their kind
		expect(edges).toContainEqual({
			from: "//projects/frontend:ci",
			to: "//projects/backend:build",
			kind: "wait_for",
		});
		expect(edges).toContainEqual({
			from: "//projects/frontend:ci",
			to: "//projects/frontend:build",
			kind: "depends_post",
		});
		// ^build follows the projects graph
		expect(edges).toContainEqual({
			from: "//projects/frontend:package",
			to: "//projects/backend:build",
			kind: "depends",
		});
		// provider-suggested object entries keep the optional flag
		expect(edges).toContainEqual({
			from: "node:frontend#test",
			to: "node:backend#test",
			kind: "depends",
			optional: true,
		});
	});

	it("does not create self edges", () => {
		const selfReferencing = [
			{
				...createTask(
					"//projects/frontend:verify",
					"/repo/projects/frontend/mise.toml",
				),
				depends: ["//projects/frontend:*"],
			},
			createTask(
				"//projects/frontend:build",
				"/repo/projects/frontend/mise.toml",
			),
		];
		const edges = getTaskDependencyEdges(selfReferencing);
		expect(edges).toEqual([
			{
				from: "//projects/frontend:verify",
				to: "//projects/frontend:build",
				kind: "depends",
			},
		]);
	});
});
