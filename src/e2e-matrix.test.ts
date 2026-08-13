import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const root = path.join(import.meta.dir, "..");

describe("ci e2e matrix", () => {
	it("runs every vscode-test config in exactly one job group", () => {
		const require = createRequire(import.meta.url);
		const configs: Array<{ label: string }> = require(
			path.join(root, ".vscode-test.js"),
		);
		const configLabels = configs.map((config) => config.label);

		const workflow = readFileSync(
			path.join(root, ".github", "workflows", "ci.yml"),
			"utf8",
		);
		const ciLabels = [...workflow.matchAll(/^\s+labels: (.+)$/gm)].flatMap(
			(match) => (match[1] as string).trim().split(/\s+/),
		);

		expect([...ciLabels].sort()).toEqual([...configLabels].sort());
	});
});
