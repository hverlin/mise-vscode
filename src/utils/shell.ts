import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";

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
