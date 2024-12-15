import { exec } from "node:child_process";
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
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			resolve({
				stdout: stdout.toString(),
				stderr: stderr.toString(),
				error,
			});
		});
	});
};

type ExecError = {
	code: number;
	stdout: string;
	stderr: string;
	message: string;
} & Error;

type SafeExecResult = {
	code: number;
	stdout: string;
	stderr: string;
};

export async function safeExec(
	cmd: string,
	args: string[] = [],
	options?: { cwd?: string } | undefined,
): Promise<SafeExecResult> {
	const escapedArgs = args.map((arg) => {
		if (arg.includes(" ") || arg.includes('"') || arg.includes("'")) {
			return `"${arg.replace(/"/g, '\\"')}"`;
		}
		return arg;
	});

	const command = [cmd, ...escapedArgs].join(" ");

	try {
		const { stdout, stderr } = await execAsync(command, { cwd: options?.cwd });
		return { code: 0, stdout, stderr };
	} catch (error: unknown) {
		logger.debug(`Error while executing command: ${command}`, error);
		if (error instanceof Error) {
			const execError = error as ExecError;
			return {
				code: execError.code ?? 1,
				stdout: execError.stdout ?? "",
				stderr: execError.stderr ?? execError.message,
			};
		}

		return { code: 1, stdout: "", stderr: String(error) };
	}
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
