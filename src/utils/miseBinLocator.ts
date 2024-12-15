import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getConfiguredBinPath } from "../configuration";
import { logger } from "./logger";
import { safeExec } from "./shell";

export async function resolveMisePath(): Promise<string> {
	const configuredPath = getConfiguredBinPath();

	if (configuredPath) {
		if (await isValidBinary(configuredPath)) {
			return configuredPath;
		}
		logger.warn(
			`Configured mise path ${configuredPath} is invalid. Trying to resolve another path...`,
		);
	}

	// Check if mise is in the PATH
	const result = await safeExec("which", ["mise"]);
	if (result.stdout) {
		return result.stdout.trim();
	}

	//  Check common installation locations
	const homedir = os.homedir();
	const commonPaths = [
		path.join(homedir, ".local", "bin", "mise"), // ~/.local/bin/mise
		path.join(homedir, "bin", "mise"), // ~/bin/mise
	];

	if (process.platform !== "win32") {
		commonPaths.push(
			"/usr/local/bin/mise",
			"/opt/homebrew/bin/mise", // Homebrew
		);
	}

	if (process.platform === "win32") {
		commonPaths.push(path.join(homedir, "scoop", "shims", "mise"));
		commonPaths.push(path.join(homedir, "scoop", "shims", "mise.exe"));
	}

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
		if (process.platform === "win32") {
			const result = await safeExec(filepath, ["--help"]);
			return result.stdout.toLowerCase().includes("mise");
		}

		const stats = await fs.stat(filepath);
		const isExecutable = (stats.mode & fs.constants.X_OK) !== 0;

		if (stats.isFile()) {
			const { stdout } = await safeExec(filepath, ["--help"]);
			return stdout.toLowerCase().includes("mise");
		}
	} catch (error) {
		logger.info(
			`Path ${filepath} is not a valid mise binary: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return false;
}
