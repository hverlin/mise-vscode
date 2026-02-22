import { describe, expect, it } from "bun:test";
import {
	extractToolNamesFromLine,
	extractToolVersionFromLine,
} from "./tomlParsing";

describe("extractToolNamesFromLine", () => {
	describe("[tools] block — bare key definitions", () => {
		it('parses simple bare key: pkl = "0.29.1"', () => {
			expect(extractToolNamesFromLine('pkl = "0.29.1"')).toEqual(["pkl"]);
		});

		it("parses single-quoted value: node = '24'", () => {
			expect(extractToolNamesFromLine("node = '24'")).toEqual(["node"]);
		});

		it('parses bare key with double-quoted value: hk = "1.18.0"', () => {
			expect(extractToolNamesFromLine('hk = "1.18.0"')).toEqual(["hk"]);
		});

		it('parses quoted key with colon: "github:cli/cli" = "latest"', () => {
			expect(extractToolNamesFromLine('"github:cli/cli" = "latest"')).toEqual([
				"github:cli/cli",
			]);
		});

		it('parses quoted key with inline table: "github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" }', () => {
			expect(
				extractToolNamesFromLine(
					'"github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" }',
				),
			).toEqual(["github:cli/cli"]);
		});

		it('parses quoted key with api_url containing github: "github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" } # Not installed', () => {
			expect(
				extractToolNamesFromLine(
					'"github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" }  # Not installed',
				),
			).toEqual(["github:cli/cli"]);
		});
	});

	describe("tasks inline tools = { ... }", () => {
		it("parses inline table: tools = { bun = 'latest', node = '18' }", () => {
			const result = extractToolNamesFromLine(
				"tools = { bun = 'latest', node = '18' }",
			);
			expect(result).toEqual(["bun", "node"]);
		});

		it("parses inline table with comment: # tools = { bun = 'latest', node = '18' }", () => {
			const result = extractToolNamesFromLine(
				"# tools = { bun = 'latest', node = '18' }",
			);
			expect(result).toEqual([]);
		});
	});

	describe("tasks tools.key = value", () => {
		it("parses tools.node = 'latest'", () => {
			expect(extractToolNamesFromLine("tools.node = 'latest'")).toEqual([
				"node",
			]);
		});

		it("parses tools.pkl = 'latest'", () => {
			expect(extractToolNamesFromLine("tools.pkl = 'latest'")).toEqual(["pkl"]);
		});

		it("parses tools.\"github:cli/cli\" = 'latest'", () => {
			expect(
				extractToolNamesFromLine("tools.\"github:cli/cli\" = 'latest'"),
			).toEqual(["github:cli/cli"]);
		});

		it("parses tools.'github:cli/cli' = 'latest' (single-quoted key)", () => {
			expect(
				extractToolNamesFromLine("tools.'github:cli/cli' = 'latest'"),
			).toEqual(["github:cli/cli"]);
		});

		it("parses tools.node with comment: tools.node = 'latest' # node: 24.11.0", () => {
			expect(
				extractToolNamesFromLine("tools.node = 'latest' # node: 24.11.0"),
			).toEqual(["node"]);
		});
	});

	describe("word filtering", () => {
		it("filters inline tools by word (bun)", () => {
			const result = extractToolNamesFromLine(
				"tools = { bun = 'latest', node = '18' }",
				"bun",
			);
			expect(result).toEqual(["bun"]);
		});

		it("filters inline tools by word (node)", () => {
			const result = extractToolNamesFromLine(
				"tools = { bun = 'latest', node = '18' }",
				"node",
			);
			expect(result).toEqual(["node"]);
		});

		it("finds github:cli/cli when searching for 'cli'", () => {
			const result = extractToolNamesFromLine(
				'"github:cli/cli" = "latest"',
				"cli",
			);
			expect(result).toEqual(["github:cli/cli"]);
		});
	});
});

describe("extractToolVersionFromLine", () => {
	describe("[tools] block", () => {
		it('extracts version from: pkl = "0.29.1"', () => {
			expect(extractToolVersionFromLine('pkl = "0.29.1"', "pkl")).toBe(
				"0.29.1",
			);
		});

		it("extracts version from: node = '24'", () => {
			expect(extractToolVersionFromLine("node = '24'", "node")).toBe("24");
		});

		it('extracts version from: hk = "1.18.0"', () => {
			expect(extractToolVersionFromLine('hk = "1.18.0"', "hk")).toBe("1.18.0");
		});

		it('extracts version from inline table: "github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" }', () => {
			expect(
				extractToolVersionFromLine(
					'"github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" }',
					"github:cli/cli",
				),
			).toBe("latest");
		});
	});

	describe("tools.key = val", () => {
		it("extracts version from: tools.pkl = 'latest'", () => {
			expect(extractToolVersionFromLine("tools.pkl = 'latest'", "pkl")).toBe(
				"latest",
			);
		});

		it("extracts version from: tools.node = 'latest'", () => {
			expect(extractToolVersionFromLine("tools.node = 'latest'", "node")).toBe(
				"latest",
			);
		});

		it("extracts version from: tools.\"github:cli/cli\" = 'latest'", () => {
			expect(
				extractToolVersionFromLine(
					"tools.\"github:cli/cli\" = 'latest'",
					"github:cli/cli",
				),
			).toBe("latest");
		});

		it("extracts version with trailing comment: tools.node = 'latest' # node: 24.11.0", () => {
			expect(
				extractToolVersionFromLine(
					"tools.node = 'latest' # node: 24.11.0",
					"node",
				),
			).toBe("latest");
		});
	});

	describe("inline table tools = { ... }", () => {
		it("extracts bun version from inline table", () => {
			expect(
				extractToolVersionFromLine(
					"tools = { bun = 'latest', node = '18' }",
					"bun",
				),
			).toBe("latest");
		});

		it("extracts node version from inline table", () => {
			expect(
				extractToolVersionFromLine(
					"tools = { bun = 'latest', node = '18' }",
					"node",
				),
			).toBe("18");
		});
	});
});
