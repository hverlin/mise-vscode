import { exec } from "node:child_process";
import { promisify } from "node:util";

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
