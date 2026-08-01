import { describe, expect, it } from "bun:test";

import {
	findToolPosition,
	getCachedTomlParser,
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

describe("calculatePositionFromSourceOffset", () => {
	// reference implementation: the original O(n)-per-offset loop
	const bruteForce = (source: string, offset: number) => {
		let line = 0;
		let character = offset === 0 ? offset : offset - 1;
		for (let i = 0; i < offset; i++) {
			if (source[i] === "\n") {
				line++;
				character = offset - (i + 1);
			}
		}
		return { line, character };
	};

	it("matches the brute-force reference for every offset", () => {
		const source = [
			"[tools]",
			'node = "22"',
			"",
			"[tasks.example]",
			'depends = ["example2"]',
			"",
		].join("\n");
		const parser = new TomlParser<MiseTomlType>(source);

		for (let offset = 0; offset <= source.length + 1; offset++) {
			expect(parser.calculatePositionFromSourceOffset(offset)).toEqual(
				bruteForce(source, offset),
			);
		}
	});

	it("handles a source without newlines", () => {
		const source = 'node = "22"';
		const parser = new TomlParser<MiseTomlType>(source);
		for (let offset = 0; offset <= source.length; offset++) {
			expect(parser.calculatePositionFromSourceOffset(offset)).toEqual(
				bruteForce(source, offset),
			);
		}
	});
});

describe("getCachedTomlParser", () => {
	const createDocument = (path: string, version: number, text: string) =>
		({
			uri: { toString: () => `file://${path}` },
			version,
			fileName: path,
			getText: () => text,
		}) as unknown as Parameters<typeof getCachedTomlParser>[0];

	it("returns the same parser instance for the same document version", () => {
		const document = createDocument("/cache/a.toml", 1, '[tools]\nnode = "22"');
		const first = getCachedTomlParser(document);
		const second = getCachedTomlParser(document);
		expect(first).toBeDefined();
		expect(second).toBe(first as TomlParser<MiseTomlType>);
	});

	it("re-parses when the document version changes", () => {
		const v1 = createDocument("/cache/b.toml", 1, '[tools]\nnode = "22"');
		const v2 = createDocument("/cache/b.toml", 2, '[tools]\nnode = "24"');
		const first = getCachedTomlParser(v1);
		const second = getCachedTomlParser(v2);
		expect(second).not.toBe(first as TomlParser<MiseTomlType>);
		expect(second?.parsed.tools).toEqual({ node: "24" });
	});

	it("serves the last good parse while the document is invalid", () => {
		const valid = createDocument("/cache/c.toml", 1, '[tools]\nnode = "22"');
		const invalid = createDocument("/cache/c.toml", 2, '[tools]\nnode = "22');
		const good = getCachedTomlParser(valid);
		const fallback = getCachedTomlParser(invalid);
		expect(fallback).toBe(good as TomlParser<MiseTomlType>);
	});

	it("returns undefined when the document never parsed successfully", () => {
		const invalid = createDocument("/cache/d.toml", 1, "[tools\nnope");
		expect(getCachedTomlParser(invalid)).toBeUndefined();
	});

	it("parses documents without a uri uncached", () => {
		const document = {
			getText: () => '[tools]\nnode = "22"',
		} as unknown as Parameters<typeof getCachedTomlParser>[0];
		const first = getCachedTomlParser(document);
		const second = getCachedTomlParser(document);
		expect(first).toBeDefined();
		expect(second).not.toBe(first as TomlParser<MiseTomlType>);
	});
});
