import {
	type ChildProcess,
	type SpawnOptions,
	spawn,
} from "node:child_process";
import { platform } from "node:os";
import * as vscode from "vscode";
import { logger } from "./logger";

export type ShellKind = "posix" | "powershell" | "cmd";

const POWERSHELL_RE = /(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i;
const CMD_RE = /(?:^|[\\/])cmd(?:\.exe)?$/i;
const POSIX_SHELL_RE = /(?:^|[\\/])(?:ba|z|k|a|da|fi|tc|c)?sh(?:\.exe)?$/i;

export function detectShellKind(shellPath: string | undefined): ShellKind {
	const shell = shellPath?.trim() ?? "";
	if (POWERSHELL_RE.test(shell)) {
		return "powershell";
	}
	if (CMD_RE.test(shell)) {
		return "cmd";
	}
	if (POSIX_SHELL_RE.test(shell)) {
		return "posix";
	}
	return platform() === "win32" ? "powershell" : "posix";
}

/** Shell of the integrated terminals, they use the default profile */
export function getTerminalShellKind(): ShellKind {
	return detectShellKind(vscode.env?.shell ?? process.env.SHELL);
}

/**
 * Values a shell reads as plain text, so quoting them would only add noise.
 * Anything outside these sets is quoted, which keeps every character a shell
 * could act on — spaces, quotes, `$`, backticks, globs, `~`, redirections,
 * separators — on the quoted side.
 */
const LITERAL_VALUE: Record<ShellKind, RegExp> = {
	// the set POSIX shells leave untouched, as used by python's shlex.quote
	posix: /^[A-Za-z0-9_@%+=:,./-]+$/,
	// `@ % ,` are operators in powershell, and `\` is a plain character
	powershell: /^[A-Za-z0-9_+=:.\\/-]+$/,
	// `%` expands variables in cmd.exe even inside quotes
	cmd: /^[A-Za-z0-9_+=:.\\/-]+$/,
};

/**
 * Quote a value so that the shell passes it along as a single literal
 * argument. Required for every value that ends up in a command line, task
 * names and tool names come from configuration files and may contain anything.
 */
export function quoteShellArg(arg: string, kind: ShellKind): string {
	if (LITERAL_VALUE[kind].test(arg)) {
		return arg;
	}
	if (kind === "powershell") {
		return `'${arg.replace(/'/g, "''")}'`;
	}
	if (kind === "cmd") {
		// cmd.exe has no escape sequence for `"` inside a quoted argument and
		// expands `%VAR%` even there, so both are dropped rather than quoted.
		return `"${arg.replace(/["%]/g, "")}"`;
	}
	return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Command line running `command` with `args`, safe to send to a terminal or to
 * a `ShellExecution`. Note that `vscode.ShellQuoting.Strong` is not an
 * alternative: it wraps a value in quotes without escaping the ones it holds.
 */
export function buildShellCommand(
	command: string,
	args: string[],
	kind: ShellKind = getTerminalShellKind(),
): string {
	const quotedCommand = quoteShellArg(command, kind);
	// powershell reads a quoted command as a string literal, `&` runs it
	const prefix = kind === "powershell" && quotedCommand !== command ? "& " : "";

	return [
		`${prefix}${quotedCommand}`,
		...args.map((arg) => quoteShellArg(arg, kind)),
	].join(" ");
}

const SHELL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * `unset` statements for `names`. Variable names come from configuration files
 * and may hold anything, the ones a shell would not accept as an identifier are
 * skipped instead of being injected into the command line.
 */
export function buildUnsetCommands(names: string[]): string {
	return names
		.filter((name) => SHELL_IDENTIFIER.test(name))
		.map((name) => `;unset ${name}`)
		.join("");
}

const ERROR_CODE_MAP = {
	ENOENT: 127,
	EACCES: 126,
	ETIMEDOUT: 124,
	EPERM: 126,
	ENOTDIR: 127,
	EISDIR: 126,
} as const;

const ERROR_TO_MESSAGE_MAP = {
	ENOENT: "Command not found",
	EACCES: "Permission denied",
	ETIMEDOUT: "Timeout",
	EPERM: "Permission denied",
	ENOTDIR: "Part of path is not a directory",
	EISDIR: "Is a directory",
} as const;

type SafeExecResult = {
	code: number;
	stdout: string;
	stderr: string;
};

type SafeExecOptions = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeout?: number;
	maxBuffer?: number;
	encoding?: BufferEncoding;
	killSignal?: NodeJS.Signals | number;
	shell?: boolean | string;
};

// a single pair of listeners for every child, registering one per call would
// go over the maximum listener count as soon as a few commands run at once
const runningProcesses = new Set<ChildProcess>();

/**
 * Node drops its default terminate-on-signal behaviour as soon as a listener
 * is attached, so the handler has to hand the signal back once it is done:
 * it detaches itself and, when nothing else is listening, re-raises so the
 * process dies as it would have. Re-raising unconditionally would run other
 * listeners a second time.
 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	const onSignal = () => {
		for (const childProcess of runningProcesses) {
			if (!childProcess.killed) {
				childProcess.kill();
			}
		}

		process.removeListener(signal, onSignal);
		if (process.listenerCount(signal) === 0) {
			process.kill(process.pid, signal);
		}
	};

	process.on(signal, onSignal);
}

export async function safeExec(
	cmd: string,
	args: string[] = [],
	options: SafeExecOptions = {},
): Promise<SafeExecResult> {
	if (typeof cmd !== "string" || !cmd.trim()) {
		return Promise.reject(new Error("Command must be a non-empty string"));
	}
	if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
		return Promise.reject(new Error("Arguments must be an array of strings"));
	}

	const {
		cwd,
		env,
		timeout = 0,
		maxBuffer = 10 * 1024 * 1024,
		encoding = "utf8",
		killSignal = "SIGTERM",
		shell = false,
	} = options;

	const spawnOptions: SpawnOptions = {
		cwd: cwd ?? process.cwd(),
		env: env ?? process.env,
		shell,
		// let node quote each argument, otherwise values containing spaces are
		// split into several arguments on Windows
		windowsVerbatimArguments: false,
		windowsHide: true,
	};

	return new Promise((resolve) => {
		let stdoutBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
		let stderrBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
		let killed = false;
		let timeoutId: Timer | null = null;

		const childProcess = spawn(cmd, args, spawnOptions);

		const cleanup = () => {
			if (childProcess.killed) {
				return;
			}
			childProcess.kill(killSignal);
			killed = true;
		};

		runningProcesses.add(childProcess);

		childProcess.on("error", (error: NodeJS.ErrnoException) => {
			const errorCode = (error.code ?? "ENOENT") as keyof typeof ERROR_CODE_MAP;
			const code = ERROR_CODE_MAP[errorCode] ?? 1;
			const message = ERROR_TO_MESSAGE_MAP[errorCode] ?? error.message;
			logger.debug(
				`Failure for command: ${cmd} ${args.join(" ")}, error: ${message}`,
				error,
			);
			resolve({
				code,
				stdout: stdoutBuffer.toString(encoding),
				stderr: `Failed to start process: ${error.message}`,
			});
		});

		function checkBufferLimit(
			buffer: Buffer,
			newData: Buffer,
			type: "stdout" | "stderr",
		): Buffer | null {
			if (buffer.length + newData.length > maxBuffer) {
				cleanup();
				resolve({
					code: 1,
					stdout: stdoutBuffer.toString(encoding),
					stderr: `${type} exceeded maxBuffer limit of ${maxBuffer} bytes`,
				});
				return null;
			}
			return Buffer.concat([buffer, newData]);
		}

		if (childProcess.stdout) {
			childProcess.stdout.on("data", (data: Buffer) => {
				const newBuffer = checkBufferLimit(stdoutBuffer, data, "stdout");
				if (newBuffer) {
					stdoutBuffer = newBuffer;
				}
			});
		}

		if (childProcess.stderr) {
			childProcess.stderr.on("data", (data: Buffer) => {
				const newBuffer = checkBufferLimit(stderrBuffer, data, "stderr");
				if (newBuffer) {
					stderrBuffer = newBuffer;
				}
			});
		}

		if (timeout > 0) {
			timeoutId = setTimeout(() => {
				cleanup();
				resolve({
					code: ERROR_CODE_MAP.ETIMEDOUT,
					stdout: stdoutBuffer.toString(encoding),
					stderr: `Process timed out after ${timeout}ms`,
				});
			}, timeout);
		}

		childProcess.on("close", (code, signal) => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			runningProcesses.delete(childProcess);

			if (killed) {
				return;
			}

			const finalCode =
				code ??
				(signal ? 128 + (typeof killSignal === "number" ? killSignal : 15) : 1);

			resolve({
				code: finalCode,
				stdout: stdoutBuffer.toString(encoding),
				stderr: stderrBuffer.toString(encoding),
			});
		});
	});
}

export const isTerminalClosed = (terminal: vscode.Terminal) => {
	return vscode.window.terminals.indexOf(terminal) === -1;
};

export const runInVscodeTerminal = async (
	terminal: vscode.Terminal,
	command: string,
) => {
	if (terminal.shellIntegration) {
		terminal.shellIntegration.executeCommand(command);
	} else {
		terminal.sendText(command);
	}
};
