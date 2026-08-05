import { describe, expect, it } from "bun:test";
import {
	formatTaskOutputs,
	getTaskDescription,
	getTaskPickDescription,
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

	it("is empty when the task has neither", () => {
		expect(getTaskDescription(task({}))).toBe("");
	});

	it("leaves the script of a file task to the group header", () => {
		expect(getTaskDescription(task({ file: "/home/me/project/build" }))).toBe(
			"",
		);
	});
});

describe("getTaskPickDescription", () => {
	it("falls back to the script of a file task, relative to the workspace", () => {
		expect(
			getTaskPickDescription(
				task({ file: "/home/me/project/mise-tasks/build" }),
				"/home/me/project",
			),
		).toBe("mise-tasks/build");
	});

	it("keeps the full script path when there is no workspace folder", () => {
		expect(getTaskPickDescription(task({ file: "/opt/tasks/build" }))).toBe(
			"/opt/tasks/build",
		);
	});

	it("prefers the description over the command and the script", () => {
		expect(
			getTaskPickDescription(
				task({
					description: "Build",
					run: ["npm run build"],
					file: "/a/build",
				}),
			),
		).toBe("Build");
	});

	it("is empty when the task has none of them", () => {
		expect(getTaskPickDescription(task({}))).toBe("");
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
