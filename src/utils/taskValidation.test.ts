import { describe, expect, it } from "bun:test";
import { TomlParser } from "./miseFileParser";
import {
	filterTaskValidationIssues,
	findFileTaskIssueLine,
	findTomlTaskIssueRange,
	findValidatedTask,
	formatTaskIssueMessage,
	getTaskIssueTarget,
} from "./taskValidation";

const issue = (
	overrides: Partial<MiseTaskValidationIssue>,
): MiseTaskValidationIssue => ({
	task: "build",
	severity: "error",
	category: "no-execution",
	message: "Task has no executable content",
	details: null,
	...overrides,
});

// as reported by `mise tasks validate --json` for `depends = ["nope"]`
const missingDependency = issue({
	task: "missing",
	category: "missing-dependency",
	message: "Dependency 'nope' not found",
	details: "Referenced in 'depends' but no matching task exists",
});

describe("getTaskIssueTarget", () => {
	it("reads the value the message quotes", () => {
		expect(getTaskIssueTarget(missingDependency)).toEqual({
			keys: ["depends", "depends_post", "wait_for"],
			value: "nope",
		});
		expect(
			getTaskIssueTarget(
				issue({
					category: "missing-daemon",
					message: "requires daemon 'db', which is not defined in [daemons]",
				}),
			),
		).toEqual({ keys: ["daemons"], value: "db" });
	});

	it("reads the output globs and the task groups of run", () => {
		expect(
			getTaskIssueTarget(
				issue({
					category: "invalid-glob-pattern",
					message: "Invalid output glob pattern: 'dist/['",
				}),
			),
		).toEqual({ keys: ["sources", "outputs"], value: "dist/[" });
		expect(
			getTaskIssueTarget(
				issue({
					category: "missing-task-reference",
					message: "Task 'lint' in task group not found",
				}),
			),
		).toEqual({ keys: ["run"], value: "lint" });
	});

	it("points at the key when the message quotes nothing", () => {
		expect(
			getTaskIssueTarget(issue({ category: "usage-parse-error" })),
		).toEqual({ keys: ["usage"] });
	});

	it("points at the task for the other categories", () => {
		expect(
			getTaskIssueTarget(issue({ category: "circular-dependency" })),
		).toEqual({ keys: [] });
	});
});

describe("filterTaskValidationIssues", () => {
	it("drops the templated dependencies mise does not render", () => {
		const templated = issue({
			task: "dev",
			category: "missing-dependency",
			message: "Dependency 'start-vscode {{usage.project}}' not found",
		});
		expect(filterTaskValidationIssues([templated, missingDependency])).toEqual([
			missingDependency,
		]);
	});

	it("drops the graph error repeating a missing dependency", () => {
		const graphError = issue({
			task: "missing",
			category: "dependency-graph-error",
			message: "Failed to build task dependency graph",
			details: "task not found: nope",
		});
		expect(filterTaskValidationIssues([graphError, missingDependency])).toEqual(
			[missingDependency],
		);
	});

	it("drops the graph error of a monorepo, followed by suggestions", () => {
		const graphError = issue({
			task: "missing",
			category: "dependency-graph-error",
			details:
				"task not found: nope\n\nDid you mean one of these?\n  - //:root",
		});
		expect(filterTaskValidationIssues([graphError, missingDependency])).toEqual(
			[missingDependency],
		);
	});

	it("drops the graph error of a task depending on the one missing a dependency", () => {
		const graphError = issue({
			task: "deploy",
			category: "dependency-graph-error",
			details: "task not found: nope",
		});
		expect(filterTaskValidationIssues([graphError, missingDependency])).toEqual(
			[missingDependency],
		);
	});

	it("keeps a graph error that no other issue explains", () => {
		const graphError = issue({
			category: "dependency-graph-error",
			details: "task not found: elsewhere",
		});
		expect(filterTaskValidationIssues([graphError])).toEqual([graphError]);
	});
});

describe("formatTaskIssueMessage", () => {
	it("adds the details on their own line", () => {
		expect(formatTaskIssueMessage(missingDependency)).toBe(
			"Dependency 'nope' not found\nReferenced in 'depends' but no matching task exists",
		);
		expect(formatTaskIssueMessage(issue({}))).toBe(
			"Task has no executable content",
		);
	});

	it("keeps only the reason of a usage spec error", () => {
		expect(
			formatTaskIssueMessage(
				issue({
					category: "usage-parse-error",
					message: "Failed to parse usage specification",
					details: [
						"invalid usage spec for task 'deploy'",
						"  × Expected quoted string",
						"   ╭─[1:5]",
						' 1 │ arg "<x',
						"   ╰────",
					].join("\n"),
				}),
			),
		).toBe("Failed to parse usage specification\nExpected quoted string");
	});
});

describe("findValidatedTask", () => {
	const task = (name: string, aliases: string[] = []) =>
		({ name, aliases, source: "mise.toml", description: "" }) as MiseTask;

	it("prefers the task of that name to an alias of another task", () => {
		const shadowing = task("a2", ["b"]);
		const b = task("b");
		expect(findValidatedTask([shadowing, b], "b")).toBe(b);
	});

	it("falls back to the aliases, e.g. the qualified name of a script task", () => {
		const script = task("node:frontend#test", ["//projects/frontend:test"]);
		expect(findValidatedTask([script], "//projects/frontend:test")).toBe(
			script,
		);
		expect(findValidatedTask([script], "missing")).toBeUndefined();
	});
});

describe("findTomlTaskIssueRange", () => {
	// the parser is off by one on the first line, keep the tasks below it
	const source = `# tasks
[tasks.missing]
run = "echo m"
depends = ["build", "nope"]
timeout = "forever"

[tasks]
lint = "eslint ."`;
	const parser = new TomlParser<object>(source);
	const find = (
		taskName: string,
		target: ReturnType<typeof getTaskIssueTarget>,
	) =>
		findTomlTaskIssueRange(
			parser.getAllPositions(),
			source.split("\n"),
			[["tasks", taskName]],
			target,
		);

	it("points at the quoted value", () => {
		expect(find("missing", getTaskIssueTarget(missingDependency))).toEqual({
			start: { line: 3, character: 21 },
			end: { line: 3, character: 25 },
		});
	});

	it("points at the key when the value is not written in the file", () => {
		expect(
			find("missing", { keys: ["depends"], value: "from-a-template" }),
		).toEqual({
			start: { line: 3, character: 0 },
			end: { line: 3, character: 7 },
		});
		expect(find("missing", { keys: ["timeout"] })).toEqual({
			start: { line: 4, character: 0 },
			end: { line: 4, character: 7 },
		});
	});

	it("points at the task name when the key is not in its table", () => {
		expect(find("missing", { keys: ["daemons"], value: "db" })).toEqual({
			start: { line: 1, character: 7 },
			end: { line: 1, character: 14 },
		});
		expect(find("lint", { keys: [] })).toEqual({
			start: { line: 7, character: 0 },
			end: { line: 7, character: 4 },
		});
	});

	it("is undefined for a task declared in another file", () => {
		expect(find("elsewhere", { keys: [] })).toBeUndefined();
	});

	it("finds the value in any of the keys of the category", () => {
		const withPost = `# tasks
[tasks.deploy]
depends = ["build"]
depends_post = ['notify']`;
		expect(
			findTomlTaskIssueRange(
				new TomlParser<object>(withPost).getAllPositions(),
				withPost.split("\n"),
				[["tasks", "deploy"]],
				{ keys: ["depends", "depends_post", "wait_for"], value: "notify" },
			),
		).toEqual({
			start: { line: 3, character: 17 },
			end: { line: 3, character: 23 },
		});
	});
});

describe("findFileTaskIssueLine", () => {
	const lines = [
		"#!/usr/bin/env bash",
		'#MISE description="Deploy"',
		'#MISE timeout="forever"',
		'#USAGE arg "<env',
		"echo deploy",
	];

	it("finds the #MISE line of the key", () => {
		expect(findFileTaskIssueLine(lines, { keys: ["timeout"] })).toBe(2);
	});

	it("finds the #USAGE lines for usage errors", () => {
		expect(findFileTaskIssueLine(lines, { keys: ["usage"] })).toBe(3);
	});

	it("supports the other comment styles of file tasks", () => {
		expect(
			findFileTaskIssueLine(["#!/usr/bin/env node", '// [MISE] dir="x"'], {
				keys: ["dir"],
			}),
		).toBe(1);
	});

	it("falls back to the first line", () => {
		expect(findFileTaskIssueLine(lines, { keys: ["daemons"] })).toBe(0);
		expect(findFileTaskIssueLine(lines, { keys: [] })).toBe(0);
	});
});
