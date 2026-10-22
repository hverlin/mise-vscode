import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import * as vscode from "vscode";
import type { ShellKind } from "./shell";
import {
	buildShellCommand,
	buildUnsetCommands,
	detectShellKind,
	quoteShellArg,
	runInVscodeTerminal,
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

describe("runInVscodeTerminal", () => {
	const window = vscode.window as unknown as Record<string, unknown>;
	const workspace = vscode.workspace as unknown as Record<string, unknown>;
	const originalGetConfiguration = workspace.getConfiguration;

	/** an event of vscode.window, fired by the test */
	const createEvent = <T>() => {
		const listeners = new Set<(value: T) => void>();
		return {
			listeners,
			event: (listener: (value: T) => void) => {
				listeners.add(listener);
				return { dispose: () => listeners.delete(listener) };
			},
			fire: (value: T) => {
				for (const listener of listeners) {
					listener(value);
				}
			},
		};
	};

	const createShellIntegration = (executed: string[]) =>
		({
			executeCommand: (command: string) => executed.push(command),
		}) as unknown as vscode.TerminalShellIntegration;

	const setUp = ({ shellIntegrationEnabled = true } = {}) => {
		const shellIntegrationChanged = createEvent<{
			terminal: vscode.Terminal;
			shellIntegration: vscode.TerminalShellIntegration;
		}>();
		const terminalClosed = createEvent<vscode.Terminal>();
		window.onDidChangeTerminalShellIntegration = shellIntegrationChanged.event;
		window.onDidCloseTerminal = terminalClosed.event;
		workspace.getConfiguration = () => ({
			get: () => shellIntegrationEnabled,
		});

		const sent: string[] = [];
		const executed: string[] = [];
		const terminal = {
			shellIntegration: undefined as
				| vscode.TerminalShellIntegration
				| undefined,
			sendText: (text: string) => sent.push(text),
		};
		const activateShellIntegration = () => {
			terminal.shellIntegration = createShellIntegration(executed);
			shellIntegrationChanged.fire({
				terminal: terminal as unknown as vscode.Terminal,
				shellIntegration: terminal.shellIntegration,
			});
		};
		return {
			terminal: terminal as unknown as vscode.Terminal,
			sent,
			executed,
			activateShellIntegration,
			close: () => terminalClosed.fire(terminal as unknown as vscode.Terminal),
			listenerCount: () =>
				shellIntegrationChanged.listeners.size + terminalClosed.listeners.size,
		};
	};

	afterEach(() => {
		delete window.onDidChangeTerminalShellIntegration;
		delete window.onDidCloseTerminal;
		workspace.getConfiguration = originalGetConfiguration;
	});

	it("runs the command with the shell integration of a ready terminal", async () => {
		const { terminal, sent, executed } = setUp();
		(terminal as { shellIntegration?: unknown }).shellIntegration =
			createShellIntegration(executed);

		await runInVscodeTerminal(terminal, "mise run hello");

		expect(executed).toEqual(["mise run hello"]);
		expect(sent).toEqual([]);
	});

	it("waits for the shell of a new terminal to be ready", async () => {
		const {
			terminal,
			sent,
			executed,
			activateShellIntegration,
			listenerCount,
		} = setUp();

		const running = runInVscodeTerminal(terminal, "mise run hello");
		await Bun.sleep(5);
		// typed before the prompt, the command would show twice
		expect(sent).toEqual([]);
		expect(executed).toEqual([]);

		activateShellIntegration();
		await running;

		expect(executed).toEqual(["mise run hello"]);
		expect(sent).toEqual([]);
		expect(listenerCount()).toBe(0);
	});

	it("types the command in when the shell has no integration", async () => {
		const { terminal, sent, executed, listenerCount } = setUp();

		await runInVscodeTerminal(terminal, "mise run hello", 10);
		expect(sent).toEqual(["mise run hello"]);
		expect(listenerCount()).toBe(0);

		// it does not wait again for a shell that did not have it
		await runInVscodeTerminal(terminal, "mise run hello", 60_000);
		expect(sent).toEqual(["mise run hello", "mise run hello"]);
		expect(executed).toEqual([]);
	});

	it("does not wait when shell integration is disabled", async () => {
		const { terminal, sent, listenerCount } = setUp({
			shellIntegrationEnabled: false,
		});

		await runInVscodeTerminal(terminal, "mise run hello", 60_000);

		expect(sent).toEqual(["mise run hello"]);
		expect(listenerCount()).toBe(0);
	});

	it("does not wait on VS Code versions without the shell integration api", async () => {
		const { terminal, sent } = setUp();
		delete window.onDidChangeTerminalShellIntegration;

		await runInVscodeTerminal(terminal, "mise run hello", 60_000);

		expect(sent).toEqual(["mise run hello"]);
	});

	it("drops the command when the terminal is closed while waiting", async () => {
		const { terminal, sent, executed, close, listenerCount } = setUp();

		const running = runInVscodeTerminal(terminal, "mise run hello", 60_000);
		close();
		await running;

		expect(sent).toEqual([]);
		expect(executed).toEqual([]);
		expect(listenerCount()).toBe(0);
	});
});
