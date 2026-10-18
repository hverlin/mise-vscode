import { describe, expect, it } from "bun:test";
import {
	type ConfigKeyExplanation,
	findConfigKeyProblems,
	findKeyName,
} from "./configExplain";

const explanation = (
	key: string,
	line: number,
	fields: Partial<ConfigKeyExplanation> = {},
): ConfigKeyExplanation => ({
	key,
	path: key.split("."),
	line,
	description: null,
	deprecated: false,
	known: true,
	suggestion: null,
	...fields,
});

describe("findKeyName", () => {
	it("finds a key however it is written", () => {
		expect(findKeyName("experimantal = true", "experimantal")).toEqual({
			start: 0,
			end: 12,
		});
		expect(findKeyName("settings.experimantal = true", "experimantal")).toEqual(
			{ start: 9, end: 21 },
		);
		expect(findKeyName("[taks]", "taks")).toEqual({ start: 1, end: 5 });
		expect(findKeyName('[tasks."b.sh"]', "b.sh")).toEqual({
			start: 8,
			end: 12,
		});
		expect(
			findKeyName('node = { version = "24", postinstal = "x" }', "postinstal"),
		).toEqual({ start: 25, end: 35 });
	});

	it("does not take a value for the key", () => {
		expect(findKeyName('run = "rn"', "rn")).toBeUndefined();
		expect(findKeyName("  rn = 'x'", "rn")).toEqual({ start: 2, end: 4 });
	});
});

describe("findConfigKeyProblems", () => {
	// captured from `mise config explain --json` 2026.10.14
	const lines = [
		'env_file = ".env"',
		"",
		"[settings]",
		"experimantal = true",
		"",
		"[tasks.b]",
		'rn = "x"',
	];

	it("reports the unknown keys with the key mise suggests", () => {
		expect(
			findConfigKeyProblems(
				[
					explanation("settings", 3),
					explanation("settings.experimantal", 4, {
						known: false,
						suggestion: "experimental",
					}),
					explanation("tasks.b.rn", 7, { known: false, suggestion: "run" }),
				],
				lines,
			),
		).toEqual([
			{
				kind: "unknown",
				key: "settings.experimantal",
				line: 3,
				start: 0,
				end: 12,
				name: "experimantal",
				message:
					"mise does not read `settings.experimantal`. Did you mean `experimental`?",
				suggestion: "experimental",
			},
			{
				kind: "unknown",
				key: "tasks.b.rn",
				line: 6,
				start: 0,
				end: 2,
				name: "rn",
				message: "mise does not read `tasks.b.rn`. Did you mean `run`?",
				suggestion: "run",
			},
		]);
	});

	it("reports the deprecated keys with what to use instead", () => {
		expect(
			findConfigKeyProblems(
				[
					explanation("env_file", 1, {
						deprecated: true,
						description:
							"dotenv file(s) to load. Deprecated; use env._.file instead. This will be removed in mise 2027.4.0.",
					}),
				],
				lines,
			),
		).toEqual([
			{
				kind: "deprecated",
				key: "env_file",
				line: 0,
				start: 0,
				end: 8,
				name: "env_file",
				message:
					"`env_file` is deprecated: use env._.file instead. This will be removed in mise 2027.4.0.",
			},
		]);
	});

	it("falls back on the whole line, and leaves out lines it does not have", () => {
		expect(
			findConfigKeyProblems(
				[
					explanation("weird", 4, { known: false }),
					explanation("gone", 40, { known: false }),
				],
				lines,
			),
		).toEqual([
			{
				kind: "unknown",
				key: "weird",
				line: 3,
				start: 0,
				end: 19,
				message: "mise does not read `weird`.",
				suggestion: undefined,
			},
		]);
	});

	it("gives the advice of each way a deprecation is described", () => {
		const messages = findConfigKeyProblems(
			[
				explanation("settings.auto_update", 1, {
					deprecated: true,
					description: "[deprecated] Old name for `self_update.auto`.",
				}),
				explanation("settings.task_timeout", 1, {
					deprecated: true,
					description: "Deprecated alias for `task.timeout`.",
				}),
				explanation("python_venv", 1, {
					deprecated: true,
					description:
						"virtualenv path to activate; use env._.python.venv instead",
				}),
				explanation("old", 1, { deprecated: true }),
			],
			["key = 1"],
		).map((problem) => problem.message);
		expect(messages).toEqual([
			"`settings.auto_update` is deprecated: Old name for `self_update.auto`.",
			"`settings.task_timeout` is deprecated: alias for `task.timeout`.",
			"`python_venv` is deprecated: virtualenv path to activate; use env._.python.venv instead",
			"`old` is deprecated.",
		]);
	});

	it("leaves out the env directives mise suggests for any short key", () => {
		const [problem] = findConfigKeyProblems(
			[explanation("dd", 1, { known: false, suggestion: "_" })],
			["dd = 1"],
		);
		expect(problem?.suggestion).toBeUndefined();
		expect(problem?.message).toBe("mise does not read `dd`.");
	});
});
