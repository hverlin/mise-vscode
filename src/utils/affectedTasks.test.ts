import { describe, expect, it } from "bun:test";
import {
	buildAffectedRunFlags,
	formatAffectedProjectRoot,
	getAffectedTaskChoices,
} from "./affectedTasks";

// `mise run --affected --affected-json '*'` with changes in two projects
const selection: MiseAffectedSelection = {
	base: "HEAD~1",
	head: "HEAD",
	projects: [
		{
			id: "cargo:agent",
			root: "crates/agent",
			reasons: [{ type: "changed-path", path: "crates/agent/new.txt" }],
		},
		{
			id: "node:frontend",
			root: "projects/frontend",
			reasons: [{ type: "changed-path", path: "projects/frontend/x.txt" }],
		},
	],
	tasks: [
		{ name: "//crates/agent:build", projects: ["cargo:agent"] },
		{ name: "//projects/frontend:build", projects: ["node:frontend"] },
		{ name: "//projects/frontend:db:reset", projects: ["node:frontend"] },
		{ name: "node:frontend#test", projects: ["node:frontend"] },
	],
};

describe("getAffectedTaskChoices", () => {
	it("groups the tasks by local name, the most shared first", () => {
		expect(getAffectedTaskChoices(selection)).toEqual([
			{ name: "build", projectRoots: ["crates/agent", "projects/frontend"] },
			{ name: "db:reset", projectRoots: ["projects/frontend"] },
			{ name: "test", projectRoots: ["projects/frontend"] },
		]);
	});

	it("keeps the project id when mise reports no root for it", () => {
		expect(
			getAffectedTaskChoices({
				...selection,
				projects: [],
				tasks: [{ name: "//:lint", projects: ["root"] }],
			}),
		).toEqual([{ name: "lint", projectRoots: ["root"] }]);
	});

	it("offers nothing when no project is affected", () => {
		expect(
			getAffectedTaskChoices({ ...selection, projects: [], tasks: [] }),
		).toEqual([]);
	});
});

describe("buildAffectedRunFlags", () => {
	it("leaves the base to mise when none is configured", () => {
		expect(buildAffectedRunFlags(undefined)).toEqual(["--affected"]);
		expect(buildAffectedRunFlags("  ")).toEqual(["--affected"]);
	});

	it("passes the configured base revision", () => {
		expect(buildAffectedRunFlags(" origin/main ")).toEqual([
			"--affected",
			"--affected-base",
			"origin/main",
		]);
	});
});

describe("formatAffectedProjectRoot", () => {
	it("qualifies the root like monorepo task names", () => {
		expect(formatAffectedProjectRoot("crates/agent")).toBe("//crates/agent");
		expect(formatAffectedProjectRoot("")).toBe("// (monorepo root)");
	});
});
