import { describe, expect, it } from "bun:test";

import {
	findToolPosition,
	type MiseTomlType,
	TomlParser,
} from "./miseFileParser";

describe("miseFileParser", () => {
	it("mise.toml", () => {
		const tomlParser = new TomlParser<MiseTomlType>(
			`
[tasks.example]
depends = [
   "example2" 
]
`.trim(),
		);

		expect(tomlParser.parsed).toEqual({
			tasks: { example: { depends: ["example2"] } },
		});

		expect(tomlParser.getAllPositions()).toEqual([
			{
				keyStart: { line: 0, character: 0 },
				keyEnd: { line: 0, character: 5 },
				valueStart: { line: 0, character: 0 },
				valueEnd: { line: 0, character: 5 },
				key: ["tasks"],
				value: { example: { depends: ["example2"] } },
			},
			{
				keyStart: { line: 0, character: 6 },
				keyEnd: { line: 0, character: 13 },
				valueStart: { line: 0, character: 0 },
				valueEnd: { line: 0, character: 14 },
				key: ["tasks", "example"],
				value: { depends: ["example2"] },
			},
			{
				keyStart: { line: 1, character: 0 },
				keyEnd: { line: 1, character: 7 },
				valueStart: { line: 1, character: 10 },
				valueEnd: { line: 3, character: 1 },
				key: ["tasks", "example", "depends"],
				value: ["example2"],
			},
		]);

		expect(tomlParser.getKeyAtPosition({ line: 0, character: 0 })).toEqual({
			keyStart: { line: 0, character: 6 },
			keyEnd: { line: 0, character: 13 },
			valueStart: { line: 0, character: 0 },
			valueEnd: { line: 0, character: 14 },
			key: ["tasks", "example"],
			value: { depends: ["example2"] },
		});

		expect(tomlParser.getKeyAtPosition({ line: 2, character: 5 })).toEqual({
			keyStart: { line: 1, character: 0 },
			keyEnd: { line: 1, character: 7 },
			valueStart: { line: 1, character: 10 },
			valueEnd: { line: 3, character: 1 },
			key: ["tasks", "example", "depends"],
			value: ["example2"],
		});
	});

	it("task files", () => {
		const tomlParser = new TomlParser<object>(
			`
ci = { depends = ["format", "build", "test"] }
`.trim(),
		);

		expect(tomlParser.parsed).toEqual({
			ci: { depends: ["format", "build", "test"] },
		});

		expect(tomlParser.getAllPositions()).toEqual([
			{
				keyStart: { line: 0, character: 0 },
				keyEnd: { line: 0, character: 1 },
				valueStart: { line: 0, character: 4 },
				valueEnd: { line: 0, character: 45 },
				key: ["ci"],
				value: { depends: ["format", "build", "test"] },
			},
			{
				keyStart: { line: 0, character: 6 },
				keyEnd: { line: 0, character: 13 },
				valueStart: { line: 0, character: 16 },
				valueEnd: { line: 0, character: 43 },
				key: ["ci", "depends"],
				value: ["format", "build", "test"],
			},
		]);
	});
});

describe("findToolPosition", () => {
	const createDocument = (fileName: string, text: string) =>
		({ fileName, getText: () => text }) as unknown as Parameters<
			typeof findToolPosition
		>[0];

	it("finds tools declared in package.json devEngines", () => {
		const document = createDocument(
			"/repo/projects/backend/package.json",
			[
				"{",
				'\t"name": "backend",',
				'\t"devEngines": {',
				'\t\t"runtime": {',
				'\t\t\t"name": "node",',
				'\t\t\t"version": "22.11.0"',
				"\t\t}",
				"\t}",
				"}",
			].join("\n"),
		);

		const range = findToolPosition(document, "node");
		expect(range?.start.line).toBe(4);
		expect(range?.start.character).toBe(12);
	});

	it("does not match tool names outside of devEngines", () => {
		const document = createDocument(
			"/repo/projects/frontend/package.json",
			[
				"{",
				'\t"name": "frontend",',
				'\t"dependencies": {',
				'\t\t"node": "*"',
				"\t}",
				"}",
			].join("\n"),
		);

		expect(findToolPosition(document, "node")).toBeUndefined();
	});

	it("still finds tools in toml files", () => {
		const document = createDocument(
			"/repo/mise.toml",
			["[tools]", 'node = "22"'].join("\n"),
		);

		const range = findToolPosition(document, "node");
		expect(range?.start.line).toBe(1);
	});
});
