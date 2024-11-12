// @ts-ignore
import { beforeEach, describe, expect, test } from "bun:test";
import {
	type TaskUsageSpec,
	parseTaskInfo,
	parseUsageSpecLine,
} from "./taskInfoParser";

describe("parseUsageSpecLine", () => {
	let spec: TaskUsageSpec;

	beforeEach(() => {
		spec = { name: "", bin: "", flags: [], args: [] };
	});

	test("parses name correctly", () => {
		parseUsageSpecLine('name "test-task"', spec);
		expect(spec.name).toBe("test-task");
	});

	test("parses bin correctly", () => {
		parseUsageSpecLine('bin "npm"', spec);
		expect(spec.bin).toBe("npm");
	});

	test("parses simple flag correctly", () => {
		parseUsageSpecLine('flag "--verbose"', spec);
		expect(spec.flags.length).toBe(1);
		expect(spec.flags[0]).toEqual({ name: "--verbose" });
	});

	test("parses flag with argument correctly", () => {
		parseUsageSpecLine('flag "--output" { arg "[FILE]" }', spec);
		expect(spec.flags.length).toBe(1);
		expect(spec.flags[0]).toEqual({ name: "--output", arg: "FILE" });
	});

	test("parses required argument correctly", () => {
		parseUsageSpecLine("arg <source>", spec);
		expect(spec.args.length).toBe(1);
		expect(spec.args[0]).toEqual({ name: "source", required: true });
	});

	test("handles malformed input gracefully", () => {
		// Empty line
		parseUsageSpecLine("", spec);
		expect(spec).toEqual({ name: "", bin: "", flags: [], args: [] });

		// Invalid flag format
		parseUsageSpecLine("flag", spec);
		expect(spec.flags).toEqual([]);

		// Invalid arg format
		parseUsageSpecLine("arg source", spec);
		expect(spec.args).toEqual([]);
	});
});

describe("parseTaskInfo", () => {
	test("parses complete task info correctly", () => {
		const input = `
Task: build
Description: Build the project
Source: ./build.ts
Run:
  npm run build
Usage Spec:
  name "build"
  bin "npm"
  flag    "--watch"
  flag "--output" { arg "[DIR]" }
  arg <src>
    `.trim();

		const result = parseTaskInfo(input);

		expect(result).toEqual({
			name: "build",
			description: "Build the project",
			source: "./build.ts",
			run: "npm run build",
			usageSpec: {
				name: "build",
				bin: "npm",
				flags: [{ name: "--watch" }, { name: "--output", arg: "DIR" }],
				args: [{ name: "src", required: true }],
			},
		});
	});

	test("handles minimal task info correctly", () => {
		const input = `
Task: minimal
Source: ./minimal.ts
Run:
  echo "minimal"
Usage Spec:
  name "minimal"
  bin "echo"
    `.trim();

		const result = parseTaskInfo(input);

		expect(result).toEqual({
			name: "minimal",
			source: "./minimal.ts",
			run: 'echo "minimal"',
			usageSpec: {
				name: "minimal",
				bin: "echo",
				flags: [],
				args: [],
			},
		});
	});

	test("handles empty lines and extra whitespace", () => {
		const input = `
Task:    format   
Description:   Format code   

Source:    ./format.ts   

Run:
   prettier --write
   
Usage Spec:
  name "format"
  bin "prettier"
  flag "--write"
    `.trim();

		const result = parseTaskInfo(input);

		expect(result).toEqual({
			name: "format",
			description: "Format code",
			source: "./format.ts",
			run: "prettier --write",
			usageSpec: {
				name: "format",
				bin: "prettier",
				flags: [{ name: "--write" }],
				args: [],
			},
		});
	});

	test("handles missing optional fields", () => {
		const input = `
Task: simple
Source: ./simple.ts
Run:
  echo
Usage Spec:
  name "simple"
  bin "echo"
    `.trim();

		const result = parseTaskInfo(input);

		expect(result.description).toBeUndefined();
		expect(result.usageSpec.flags).toEqual([]);
		expect(result.usageSpec.args).toEqual([]);
	});

	test("handles multiple flags and args", () => {
		const input = `
Task: complex
Source: ./complex.ts
Run:
  tsc
Usage Spec:
  name "complex"
  bin "tsc"
  flag "--watch"
  flag "--project" { 
  arg "[PATH]"
   }
  flag "--outDir" { arg "[DIR]" }
  arg <entryPoint>
  arg <configFile>
    `.trim();

		const result = parseTaskInfo(input);

		expect(result.usageSpec.flags).toEqual([
			{ name: "--watch" },
			{ name: "--project", arg: "PATH" },
			{ name: "--outDir", arg: "DIR" },
		]);
		expect(result.usageSpec.args).toEqual([
			{ name: "entryPoint", required: true },
			{ name: "configFile", required: true },
		]);
	});

	test("handles multiline run commands", () => {
		const input = `
Task: build
Source: ./build.ts
Run:
  npm install &&
  npm run build &&
  npm test
Usage Spec:
  name "build"
  bin "npm"
    `.trim();

		const result = parseTaskInfo(input);
		expect(result.run).toBe("npm install &&\nnpm run build &&\nnpm test");
	});

	test("example cargo task", () => {
		const input = `
Task: cargoTest
Description:
Source: ~/Projects/mise-test/mise.toml

Run:
  cargo test {{arg(name="file")}} {{option(name="features")}} {{flag(name="verbose")}}

Usage Spec:
  name "cargoTest"
  bin "cargoTest"
  flag "--features" {
      arg "[features]"
  }
  flag "--verbose"
  arg "<file>"`.trim();

		const result = parseTaskInfo(input);
		expect(result).toEqual({
			name: "cargoTest",
			description: "",
			source: "~/Projects/mise-test/mise.toml",
			run: 'cargo test {{arg(name="file")}} {{option(name="features")}} {{flag(name="verbose")}}',
			usageSpec: {
				name: "cargoTest",
				bin: "cargoTest",
				flags: [{ name: "--features", arg: "features" }, { name: "--verbose" }],
				args: [{ name: "file", required: true }],
			},
		});
	});
});
