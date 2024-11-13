import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { logger } from "./logger";
import { execAsync } from "./shell";

export async function resolveMisePath(): Promise<string> {
	const config = vscode.workspace.getConfiguration("mise");
	const configuredPath = config.get<string>("binPath")?.trim();

	if (configuredPath) {
		if (await isValidBinary(configuredPath)) {
			return configuredPath;
		}
		logger.warn(
			`Configured mise path ${configuredPath} is invalid. Trying to resolve another path...`,
		);
	}

	// Check if mise is in the PATH
	const { stdout } = await execAsync("which mise").catch(() => ({
		stdout: "",
	}));
	if (stdout) {
		return stdout.trim();
	}

	//  Check common installation locations
	const homedir = os.homedir();
	const commonPaths = [
		path.join(homedir, ".local", "bin", "mise"), // ~/.local/bin/mise
		"/usr/local/bin/mise", // Homebrew
		"/opt/homebrew/bin/mise", // Homebrew
		path.join(homedir, "bin", "mise"), // ~/bin/mise
	];

	const allPaths = [...commonPaths];

	for (const binPath of allPaths) {
		if (await isValidBinary(binPath)) {
			return binPath;
		}
	}

	throw new Error(
		"Could not find mise binary in any standard location (PATH, ~/.local/bin, ~/bin, /usr/local/bin, /opt/homebrew/bin...)",
	);
}

export async function isValidBinary(filepath: string): Promise<boolean> {
	try {
		const stats = await fs.stat(filepath);
		const isExecutable = (stats.mode & fs.constants.X_OK) !== 0;
		if (stats.isFile() && isExecutable) {
			const { stdout } = await execAsync(`"${filepath}" --help`);
			return stdout.toLowerCase().includes("mise");
		}
	} catch (error) {
		logger.info(
			`Path ${filepath} is not a valid mise binary: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return false;
}
