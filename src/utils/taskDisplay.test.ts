import { describe, expect, it } from "bun:test";
import {
	formatRunEntries,
	formatTaskOutputs,
	formatTaskRunRequirements,
	getTaskDescription,
} from "./taskDisplay";

const task = (overrides: Partial<MiseTask>): MiseTask =>
	({
		name: "build",
		source: "mise.toml",
		description: "",
		...overrides,
	}) as MiseTask;

describe("getTaskDescription", () => {
	it("uses the description when the task has one", () => {
		expect(getTaskDescription(task({ description: "Build the project" }))).toBe(
			"Build the project",
		);
	});

	it("falls back to the command of an undocumented task", () => {
		expect(getTaskDescription(task({ run: ["npm run build"] }))).toBe(
			"npm run build",
		);
	});

	it("describes an undocumented task by the tasks its run references", () => {
		expect(getTaskDescription(task({ run: [{ task: "lint" }] }))).toBe(
			"task: lint",
		);
	});

	it("is empty when the task has neither", () => {
		expect(getTaskDescription(task({}))).toBe("");
	});

	it("leaves the script of a file task to the group header", () => {
		expect(getTaskDescription(task({ file: "/home/me/project/build" }))).toBe(
			"",
		);
	});
});

describe("formatRunEntries", () => {
	it("keeps the shell commands as written", () => {
		expect(formatRunEntries(["echo a", "echo b"])).toEqual([
			"echo a",
			"echo b",
		]);
	});

	it("renders the task entries with the keys of the config", () => {
		expect(
			formatRunEntries([
				{ task: "build" },
				{ task: "build", args: ["--release"] },
				{ tasks: ["lint", "test"] },
			]),
		).toEqual(["task: build", "task: build --release", "tasks: lint, test"]);
	});

	it("handles a task without a run", () => {
		expect(formatRunEntries(undefined)).toEqual([]);
	});
});

describe("formatTaskOutputs", () => {
	it("formats the files array emitted by mise", () => {
		expect(formatTaskOutputs(["dist/**", "coverage/**"])).toBe(
			"dist/**, coverage/**",
		);
	});

	it("formats auto-detected outputs", () => {
		expect(formatTaskOutputs({ auto: true })).toBe("Auto-detected");
	});
});

describe("formatTaskRunRequirements", () => {
	it("lists the daemons, secrets and timeout of the task", () => {
		expect(
			formatTaskRunRequirements(
				task({
					daemons: ["db", "cache"],
					secrets: ["DEPLOY_KEY"],
					timeout: "5m",
				}),
			),
		).toEqual([
			"Daemons: `db`, `cache`",
			"Secrets: `DEPLOY_KEY`",
			"Timeout: `5m`",
		]);
	});

	it("names every daemon when the task requires all of them", () => {
		expect(formatTaskRunRequirements(task({ daemons: true }))).toEqual([
			"Daemons: every project daemon",
		]);
	});

	it("is empty for the values mise reports when nothing is set", () => {
		expect(
			formatTaskRunRequirements(
				task({ daemons: null, secrets: [], timeout: null }),
			),
		).toEqual([]);
	});
});
