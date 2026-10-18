import { describe, expect, it } from "bun:test";
import { TomlParser } from "./miseFileParser";
import {
	findProjectCheckPosition,
	formatProjectCheckDetail,
	formatProjectChecksSummary,
	isFailedProjectCheck,
	sortProjectChecks,
} from "./projectChecks";

const check = (overrides: Partial<MiseProjectCheck>): MiseProjectCheck => ({
	name: "node",
	description: null,
	source: "/project/mise.toml",
	status: "pass",
	message: null,
	hint: null,
	...overrides,
});

// as reported by `mise doctor project --json`
const checks = [
	check({ name: "node", status: "pass" }),
	check({ name: "slow", status: "error", message: "timed out after 1s" }),
	check({
		name: "fails",
		status: "fail",
		message: "Command exited with exit status: 3",
		hint: "fix it",
	}),
	check({ name: "linux-only", status: "skipped" }),
];

describe("sortProjectChecks", () => {
	it("lists the checks needing attention first", () => {
		expect(sortProjectChecks(checks).map(({ name }) => name)).toEqual([
			"fails",
			"slow",
			"linux-only",
			"node",
		]);
	});
});

describe("formatProjectChecksSummary", () => {
	it("counts the checks of each status", () => {
		expect(formatProjectChecksSummary(checks)).toBe(
			"1 failed, 1 could not run, 1 skipped, 1 passed",
		);
		expect(formatProjectChecksSummary([check({}), check({})])).toBe("2 passed");
	});
});

describe("isFailedProjectCheck", () => {
	it("is true for the checks that failed or could not run", () => {
		expect(checks.filter(isFailedProjectCheck).map(({ name }) => name)).toEqual(
			["slow", "fails"],
		);
	});
});

describe("formatProjectCheckDetail", () => {
	it("joins the message and the hint", () => {
		expect(formatProjectCheckDetail(checks[2] as MiseProjectCheck)).toBe(
			"Command exited with exit status: 3 · Hint: fix it",
		);
		expect(formatProjectCheckDetail(check({}))).toBe("");
	});
});

describe("findProjectCheckPosition", () => {
	it("finds the table declaring the check", () => {
		const parser = new TomlParser<object>(`[tools]
node = "24"

[doctor.checks.node]
run = "node --version"`);
		expect(findProjectCheckPosition(parser.getAllPositions(), "node")).toEqual({
			line: 3,
			character: 15,
		});
		expect(
			findProjectCheckPosition(parser.getAllPositions(), "missing"),
		).toBeUndefined();
	});
});
