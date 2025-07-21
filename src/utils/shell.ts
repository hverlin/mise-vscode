import { exec, type SpawnOptions, spawn } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { logger } from "./logger";

export const execAsync = promisify(exec);

export const execAsyncMergeOutput = (
	command: string,
): Promise<{
	stdout: string;
	stderr: string;
	error: Error | null;
}> => {
	return new Promise((resolve) => {
		exec(command, (error, stdout, stderr) => {
			resolve({
				stdout: stdout.toString(),
				stderr: stderr.toString(),
				error,
			});
		});
	});
};

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
		windowsVerbatimArguments: platform() === "win32",
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

		process.on("SIGINT", cleanup);
		process.on("SIGTERM", cleanup);

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
			process.removeListener("SIGINT", cleanup);
			process.removeListener("SIGTERM", cleanup);

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
