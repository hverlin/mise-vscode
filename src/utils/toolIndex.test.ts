import { describe, expect, it } from "bun:test";
import type * as vscode from "vscode";
import { type MiseTomlType, TomlParser } from "./miseFileParser";
import {
	buildToolIndex,
	buildToolVersionsIndex,
	type DeclaredTool,
	getToolIndexForDocument,
	isConcreteVersion,
} from "./toolIndex";

function indexOf(source: string): DeclaredTool[] {
	return buildToolIndex(new TomlParser<MiseTomlType>(source));
}

function byName(tools: DeclaredTool[], name: string): DeclaredTool {
	const tool = tools.find((t) => t.toolName === name);
	if (!tool) {
		throw new Error(`tool ${name} not found in index`);
	}
	return tool;
}

describe("buildToolIndex", () => {
	it("indexes simple [tools] block entries", () => {
		const tools = indexOf(
			["[tools]", 'node = "22"', "pkl = '0.29.1'"].join("\n"),
		);
		expect(tools.map((t) => t.toolName)).toEqual(["node", "pkl"]);
		expect(byName(tools, "node")).toMatchObject({
			requestedVersion: "22",
			inTask: false,
		});
		expect(byName(tools, "node").range.start).toMatchObject({
			line: 1,
			character: 0,
		});
		expect(byName(tools, "node").range.end).toMatchObject({
			line: 1,
			character: 4,
		});
	});

	it("indexes quoted backend keys", () => {
		const tools = indexOf(
			["[tools]", '"github:cli/cli" = "latest"'].join("\n"),
		);
		expect(byName(tools, "github:cli/cli").requestedVersion).toBe("latest");
		// the range covers the quoted token
		expect(byName(tools, "github:cli/cli").range.start.character).toBe(0);
		expect(byName(tools, "github:cli/cli").range.end.character).toBe(
			'"github:cli/cli"'.length,
		);
	});

	it("indexes inline options tables and reads their version", () => {
		const tools = indexOf(
			[
				"[tools]",
				'ripgrep = { version = "latest", os = ["linux", "macos"] }',
				'nothing = { postinstall = "corepack enable" }',
			].join("\n"),
		);
		expect(byName(tools, "ripgrep").requestedVersion).toBe("latest");
		expect(byName(tools, "nothing").requestedVersion).toBeUndefined();
	});

	it("indexes arrays of versions using the first entry", () => {
		const tools = indexOf(["[tools]", 'python = ["3.10", "3.11"]'].join("\n"));
		expect(byName(tools, "python").requestedVersion).toBe("3.10");
	});

	it("indexes multi-line arrays of versions", () => {
		const tools = indexOf(
			["[tools]", "python = [", '  "3.10",', '  "3.11",', "]"].join("\n"),
		);
		expect(byName(tools, "python").requestedVersion).toBe("3.10");
		expect(byName(tools, "python").range.start.line).toBe(1);
	});

	it("indexes dotted keys", () => {
		const tools = indexOf(
			["[tools]", '"ubi:sharkdp/fd".version = "latest"'].join("\n"),
		);
		expect(byName(tools, "ubi:sharkdp/fd").requestedVersion).toBe("latest");
		expect(byName(tools, "ubi:sharkdp/fd").range.start.line).toBe(1);
	});

	it("indexes [tools.<name>] sections with the range on the header", () => {
		const tools = indexOf(
			[
				"[tools.node]",
				'version = "22"',
				'postinstall = "corepack enable"',
				"",
				'[tools."npm:prettier"]',
				'version = "3.0.0"',
			].join("\n"),
		);
		expect(tools.map((t) => t.toolName)).toEqual(["node", "npm:prettier"]);
		expect(byName(tools, "node")).toMatchObject({
			requestedVersion: "22",
			inTask: false,
		});
		expect(byName(tools, "node").range.start).toMatchObject({
			line: 0,
			character: "[tools.".length,
		});
		expect(byName(tools, "npm:prettier").range.start.line).toBe(4);
		expect(byName(tools, "npm:prettier").requestedVersion).toBe("3.0.0");
	});

	it("reads a version array inside a [tools.<name>] section", () => {
		const tools = indexOf(
			["[tools.python]", 'version = ["3.10", "3.11"]'].join("\n"),
		);
		expect(byName(tools, "python").requestedVersion).toBe("3.10");
	});

	it("does not index tool options or platform sub-tables as tools", () => {
		const tools = indexOf(
			[
				'[tools."http:my-tool"]',
				'version = "1.0.0"',
				"",
				'[tools."http:my-tool".platforms]',
				'macos-x64 = { url = "https://example.com/x.tar.gz" }',
			].join("\n"),
		);
		expect(tools.map((t) => t.toolName)).toEqual(["http:my-tool"]);
	});

	it("indexes task tools from inline tables and dotted keys as inTask", () => {
		const tools = indexOf(
			[
				"[tasks.build]",
				'run = "echo build"',
				"tools = { bun = 'latest', node = '18' }",
				"",
				"[tasks.lint]",
				"tools.pkl = 'latest'",
				'run = "echo lint"',
			].join("\n"),
		);
		expect(tools.map((t) => t.toolName)).toEqual(["bun", "node", "pkl"]);
		expect(tools.every((t) => t.inTask)).toBe(true);
		expect(byName(tools, "node").requestedVersion).toBe("18");
		expect(byName(tools, "node").range.start.line).toBe(2);
		expect(byName(tools, "pkl").range.start.line).toBe(5);
	});

	it("does not treat a task named tools as a tools table", () => {
		const tools = indexOf(
			["[tasks.tools]", 'run = "echo listing tools"'].join("\n"),
		);
		expect(tools).toEqual([]);
	});

	it("does not index other sections", () => {
		const tools = indexOf(
			["[env]", 'FOO = "bar"', "", "[settings]", "experimental = true"].join(
				"\n",
			),
		);
		expect(tools).toEqual([]);
	});

	it("indexes a mixed document completely", () => {
		const tools = indexOf(
			[
				"[tools]",
				'"github:cli/cli" = "latest"',
				'python = ["3.10", "3.11"]',
				"",
				"[tools.node]",
				'version = "22"',
				"",
				"[tasks.build]",
				"tools = { bun = 'latest' }",
			].join("\n"),
		);
		expect(tools.map((t) => t.toolName).sort()).toEqual([
			"bun",
			"github:cli/cli",
			"node",
			"python",
		]);
	});
});

function fakeDocument(fileName: string, content: string): vscode.TextDocument {
	const lines = content.split("\n");
	return {
		fileName,
		lineCount: lines.length,
		lineAt: (line: number) => ({ text: lines[line] ?? "" }),
		getText: () => content,
	} as unknown as vscode.TextDocument;
}

describe("buildToolVersionsIndex", () => {
	const index = (content: string) =>
		buildToolVersionsIndex(fakeDocument("/repo/.tool-versions", content));

	it("indexes simple tool lines", () => {
		const tools = index(["nodejs 20.11.0", "shellcheck 0.10.0"].join("\n"));
		expect(tools.map((t) => t.toolName)).toEqual(["nodejs", "shellcheck"]);
		expect(byName(tools, "nodejs")).toMatchObject({
			requestedVersion: "20.11.0",
			inTask: false,
		});
		expect(byName(tools, "nodejs").range.start).toMatchObject({
			line: 0,
			character: 0,
		});
		expect(byName(tools, "nodejs").range.end).toMatchObject({
			line: 0,
			character: "nodejs".length,
		});
	});

	it("uses the first entry of multiple versions", () => {
		const tools = index("python 3.12.0 3.11.0");
		expect(byName(tools, "python").requestedVersion).toBe("3.12.0");
	});

	it("skips blank lines and comments", () => {
		const tools = index(
			["# tools for this repo", "", "nodejs 20.11.0", "   ", "# python 3"].join(
				"\n",
			),
		);
		expect(tools.map((t) => t.toolName)).toEqual(["nodejs"]);
		expect(byName(tools, "nodejs").range.start.line).toBe(2);
	});

	it("strips trailing comments", () => {
		const tools = index("nodejs 20.11.0 # pinned for CI");
		expect(byName(tools, "nodejs").requestedVersion).toBe("20.11.0");
	});

	it("handles a tool without a version", () => {
		const tools = index("nodejs");
		expect(byName(tools, "nodejs").requestedVersion).toBeUndefined();
	});

	it("handles indentation and CRLF line endings", () => {
		const tools = index("  nodejs 20.11.0\r\nrust 1.80.0\r\n");
		expect(byName(tools, "nodejs").range.start.character).toBe(2);
		expect(byName(tools, "rust").requestedVersion).toBe("1.80.0");
	});

	it("keeps scoped version specifiers verbatim", () => {
		const tools = index("ruby ref:master");
		expect(byName(tools, "ruby").requestedVersion).toBe("ref:master");
	});
});

describe("isConcreteVersion", () => {
	it("accepts plain and fuzzy versions", () => {
		for (const version of ["20.11.0", "3.12", "v1.2.3", "2025.1.1"]) {
			expect(isConcreteVersion(version)).toBe(true);
		}
	});

	it("rejects scoped and symbolic versions", () => {
		for (const version of [
			"latest",
			"system",
			"lts",
			"lts-hydrogen",
			"ref:master",
			"path:/opt/node",
			"prefix:20",
			"sub-1:latest",
		]) {
			expect(isConcreteVersion(version)).toBe(false);
		}
	});
});

describe("getToolIndexForDocument", () => {
	it("routes .tool-versions files to the line parser", () => {
		const document = fakeDocument("/repo/.tool-versions", "nodejs 20.11.0");
		expect(getToolIndexForDocument(document).map((t) => t.toolName)).toEqual([
			"nodejs",
		]);
	});

	it("routes TOML files to the TOML index", () => {
		const document = fakeDocument("/repo/mise.toml", '[tools]\nnode = "22"');
		expect(getToolIndexForDocument(document).map((t) => t.toolName)).toEqual([
			"node",
		]);
	});

	it("returns an empty index for unparseable TOML", () => {
		const document = fakeDocument("/repo/mise.toml", "[tools\nnope");
		expect(getToolIndexForDocument(document)).toEqual([]);
	});

	it("does not treat similarly named files as .tool-versions", () => {
		const document = fakeDocument("/repo/foo.tool-versions", "nodejs 20");
		expect(getToolIndexForDocument(document)).toEqual([]);
	});
});
