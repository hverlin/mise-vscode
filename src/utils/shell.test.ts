import { describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import type { ShellKind } from "./shell";
import {
	buildShellCommand,
	buildUnsetCommands,
	detectShellKind,
	quoteShellArg,
} from "./shell";

const runInSh = (command: string) =>
	new Promise<string>((resolve, reject) => {
		execFile("/bin/sh", ["-c", command], (error, stdout) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});

describe("detectShellKind", () => {
	it("detects powershell", () => {
		expect(detectShellKind("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(
			"powershell",
		);
		expect(
			detectShellKind(
				"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			),
		).toBe("powershell");
	});

	it("detects cmd", () => {
		expect(detectShellKind("C:\\Windows\\System32\\cmd.exe")).toBe("cmd");
	});

	it("detects posix shells, including the ones shipped on windows", () => {
		expect(detectShellKind("/bin/zsh")).toBe("posix");
		expect(detectShellKind("/usr/bin/fish")).toBe("posix");
		expect(detectShellKind("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(
			"posix",
		);
	});

	it("falls back to the platform default for unknown shells", () => {
		expect(detectShellKind(undefined)).toBe(
			process.platform === "win32" ? "powershell" : "posix",
		);
	});
});

describe("quoteShellArg", () => {
	const injections = [
		'x"; touch pwned #',
		"x'; touch pwned #",
		"$(touch pwned)",
		"`touch pwned`",
		"a && touch pwned",
		"a | touch pwned",
		"a\ntouch pwned",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion
		"${IFS}",
		"*",
		"~",
	];

	it.each(injections)(
		"keeps %p a single literal argument in sh",
		async (arg) => {
			const output = await runInSh(
				`printf '%s' ${quoteShellArg(arg, "posix")}`,
			);
			expect(output).toBe(arg);
		},
	);

	it("quotes for powershell by doubling single quotes", () => {
		expect(quoteShellArg("x'; rm -rf /", "powershell")).toBe("'x''; rm -rf /'");
		expect(quoteShellArg("$(whoami)", "powershell")).toBe("'$(whoami)'");
	});

	it("drops the characters cmd.exe cannot quote", () => {
		expect(quoteShellArg('a" & b', "cmd")).toBe('"a & b"');
		expect(quoteShellArg("%USERPROFILE%", "cmd")).toBe('"USERPROFILE"');
	});
});

describe("buildUnsetCommands", () => {
	it("unsets every valid variable name", () => {
		expect(buildUnsetCommands(["PATH", "_a1", "NODE_ENV"])).toBe(
			";unset PATH;unset _a1;unset NODE_ENV",
		);
	});

	it("skips names a shell would not accept as an identifier", () => {
		expect(
			buildUnsetCommands([
				"OK",
				"a; touch pwned #",
				"$(touch pwned)",
				"a b",
				"1abc",
				"",
			]),
		).toBe(";unset OK");
	});
});

describe("quoteShellArg literal values", () => {
	const kinds: ShellKind[] = ["posix", "powershell", "cmd"];

	it.each(kinds)("leaves an ordinary word untouched in %s", (kind) => {
		expect(quoteShellArg("run", kind)).toBe("run");
		expect(quoteShellArg("build-all", kind)).toBe("build-all");
		expect(quoteShellArg("--env", kind)).toBe("--env");
	});

	it.each(kinds)("quotes anything a %s shell could act on", (kind) => {
		const metacharacters = [
			" ",
			"\t",
			"'",
			'"',
			"`",
			"$",
			"&",
			"|",
			";",
			"<",
			">",
			"(",
			")",
			"{",
			"}",
			"[",
			"]",
			"*",
			"?",
			"!",
			"#",
			"~",
			"\n",
			"\\",
		];

		for (const character of metacharacters) {
			if (kind !== "posix" && character === "\\") {
				// a plain path separator on windows shells
				continue;
			}
			const value = `a${character}b`;
			expect({ kind, value, quoted: quoteShellArg(value, kind) }).not.toEqual({
				kind,
				value,
				quoted: value,
			});
		}
	});

	it.each(kinds)("quotes an empty value in %s", (kind) => {
		expect(quoteShellArg("", kind)).not.toBe("");
	});
});

describe("buildShellCommand", () => {
	it("leaves plain values unquoted, they read as themselves", () => {
		expect(buildShellCommand("/usr/bin/mise", ["run", "build"], "posix")).toBe(
			"/usr/bin/mise run build",
		);
		expect(
			buildShellCommand("C:\\bin\\mise.exe", ["run", "build"], "powershell"),
		).toBe("C:\\bin\\mise.exe run build");
	});

	it("quotes only the values that need it", () => {
		expect(
			buildShellCommand("/usr/bin/mise", ["run", "build all"], "posix"),
		).toBe("/usr/bin/mise run 'build all'");
	});

	it("calls the executable with & when its path had to be quoted", () => {
		expect(
			buildShellCommand(
				"C:\\Program Files\\mise.exe",
				["run", "build"],
				"powershell",
			),
		).toBe("& 'C:\\Program Files\\mise.exe' run build");
	});

	it("does not let a task name escape the command", async () => {
		const command = buildShellCommand(
			"printf",
			["%s", 'x"; touch pwned #'],
			"posix",
		);
		expect(await runInSh(command)).toBe('x"; touch pwned #');
	});
});
