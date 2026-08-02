import { beforeEach, describe, expect, test } from "bun:test";
import {
	parseTaskInfo,
	parseTaskInfoJson,
	parseUsageSpecLine,
	type TaskUsageSpec,
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

describe("parseTaskInfoJson", () => {
	// Trimmed-down output of `mise tasks info deploy --json` for a task with a usage field
	const deployTaskJson = {
		name: "deploy",
		description: "Deploy the app",
		source: "/project/mise.toml",
		run: ['echo "Deploying to $usage_environment"'],
		usage_spec: {
			name: "deploy",
			bin: "deploy",
			cmd: {
				usage: "[-v --verbose] [--format <format>] <environment> [region]",
				args: [
					{
						name: "environment",
						usage: "<environment>",
						help: "Target environment",
						help_first_line: "Target environment",
						required: true,
						hide: false,
						choices: { choices: ["dev", "staging", "prod"] },
					},
					{
						name: "region",
						usage: "[region]",
						help: "Optional region",
						help_first_line: "Optional region",
						required: false,
						hide: false,
						default: ["us-east-1"],
					},
				],
				flags: [
					{
						name: "verbose",
						usage: "-v --verbose",
						help: "Enable verbose output",
						help_first_line: "Enable verbose output",
						short: ["v"],
						long: ["verbose"],
						hide: false,
						global: false,
					},
					{
						name: "format",
						usage: "--format <format>",
						help: "Output format",
						help_first_line: "Output format",
						short: [],
						long: ["format"],
						hide: false,
						global: false,
						arg: {
							name: "format",
							usage: "",
							required: true,
							hide: false,
							choices: { choices: ["text", "json"] },
						},
						default: ["text"],
					},
				],
			},
		},
	};

	test("parses a task with args and flags", () => {
		const result = parseTaskInfoJson(JSON.stringify(deployTaskJson));

		expect(result).toEqual({
			name: "deploy",
			description: "Deploy the app",
			source: "/project/mise.toml",
			run: 'echo "Deploying to $usage_environment"',
			usageSpec: {
				name: "deploy",
				bin: "deploy",
				args: [
					{
						name: "environment",
						required: true,
						help: "Target environment",
						choices: ["dev", "staging", "prod"],
					},
					{
						name: "region",
						required: false,
						help: "Optional region",
						default: "us-east-1",
					},
				],
				flags: [
					{ name: "--verbose", help: "Enable verbose output" },
					{
						name: "--format",
						arg: "format",
						help: "Output format",
						default: "text",
						choices: ["text", "json"],
					},
				],
			},
		});
	});

	test("skips hidden args and flags", () => {
		const result = parseTaskInfoJson(
			JSON.stringify({
				name: "task",
				source: "/project/mise.toml",
				run: ["echo"],
				usage_spec: {
					name: "task",
					bin: "task",
					cmd: {
						args: [{ name: "secret", required: true, hide: true }],
						flags: [{ name: "internal", long: ["internal"], hide: true }],
					},
				},
			}),
		);

		expect(result.usageSpec.args).toEqual([]);
		expect(result.usageSpec.flags).toEqual([]);
	});

	test("uses the short flag name when no long name exists", () => {
		const result = parseTaskInfoJson(
			JSON.stringify({
				name: "task",
				source: "/project/mise.toml",
				run: ["echo"],
				usage_spec: {
					name: "task",
					bin: "task",
					cmd: { flags: [{ name: "verbose", short: ["v"], long: [] }] },
				},
			}),
		);

		expect(result.usageSpec.flags).toEqual([{ name: "-v" }]);
	});

	test("joins multiple run commands", () => {
		const result = parseTaskInfoJson(
			JSON.stringify({
				name: "build",
				source: "/project/mise.toml",
				run: ["npm install", "npm run build"],
			}),
		);

		expect(result.run).toBe("npm install\nnpm run build");
		expect(result.usageSpec).toEqual({
			name: "build",
			bin: "",
			flags: [],
			args: [],
		});
	});

	test("handles a task without a usage spec", () => {
		const result = parseTaskInfoJson(
			JSON.stringify({
				name: "minimal",
				description: "",
				source: "/project/mise.toml",
				run: 'echo "minimal"',
			}),
		);

		expect(result).toEqual({
			name: "minimal",
			source: "/project/mise.toml",
			run: 'echo "minimal"',
			usageSpec: { name: "minimal", bin: "", flags: [], args: [] },
		});
	});

	test("throws on invalid json", () => {
		expect(() => parseTaskInfoJson("not json")).toThrow();
	});
});
