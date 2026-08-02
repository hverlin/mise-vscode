import * as os from "node:os";
import * as path from "node:path";
import {
	getConfiguredBinPath,
	shouldAutoDetectMiseBinPath,
} from "../configuration";
import { isPathInside } from "./fileUtils";
import { logger } from "./logger";
import { safeExec } from "./shell";

export class WorkspaceBinaryNotApprovedError extends Error {
	constructor(readonly binPath: string) {
		super(`The mise binary of this workspace was not approved: ${binPath}`);
		this.name = "WorkspaceBinaryNotApprovedError";
	}
}

export type ResolveMisePathOptions = {
	/**
	 * Roots the candidates are checked against, no check without them. Every
	 * folder of the workspace counts: a relative `mise.binPath` resolves against
	 * whichever folder holds the file, not only the selected one.
	 */
	workspaceRoots?: string[];
	confirmWorkspaceBinary?: (binPath: string) => Promise<boolean>;
};

export async function resolveMisePath(
	options: ResolveMisePathOptions = {},
): Promise<string> {
	const configuredPath = getConfiguredBinPath();
	logger.debug(`Configured mise path: ${configuredPath}`);

	const { workspaceRoots = [], confirmWorkspaceBinary } = options;

	// gates every execution below: isValidBinary runs the candidate
	const isUsableBinary = async (binPath: string) => {
		if (
			confirmWorkspaceBinary &&
			workspaceRoots.some((root) => isPathInside(root, binPath))
		) {
			logger.info(`mise binary candidate is inside the workspace: ${binPath}`);
			if (!(await confirmWorkspaceBinary(binPath))) {
				throw new WorkspaceBinaryNotApprovedError(binPath);
			}
		}
		return isValidBinary(binPath);
	};

	const autoDetectMiseBinPath = shouldAutoDetectMiseBinPath();
	if (configuredPath) {
		if (await isUsableBinary(configuredPath)) {
			return configuredPath;
		}
		if (autoDetectMiseBinPath) {
			logger.warn(
				`Configured mise path "${configuredPath}" is invalid. Trying to resolve another path...`,
			);
		}
	}

	if (!autoDetectMiseBinPath) {
		throw new Error(
			`Auto-detection of mise binary is disabled and currently configured path ${configuredPath} is invalid`,
		);
	}

	// Check if mise is in the PATH
	// the default value (`mise`) should already be enough for most cases

	// check for win32 first, as `which` (see https://github.com/hverlin/mise-vscode/issues/84)
	if (process.platform === "win32") {
		const result = await safeExec("where.exe", ["mise"]);
		logger.info(`where mise: ${result.stdout}`);
		const firstEntry = result.stdout.split("\r\n")?.[0];
		const miseLocation = firstEntry?.trim();
		if (miseLocation && (await isUsableBinary(miseLocation))) {
			return miseLocation;
		}
	}

	const result = await safeExec("which", ["mise"]);
	const miseLocation = result.stdout?.trim();
	logger.info(`which mise: ${miseLocation}`);
	if (miseLocation && (await isUsableBinary(miseLocation))) {
		return miseLocation;
	}

	//  Check common installation locations
	const homedir = os.homedir();
	const commonPaths = [
		path.join(homedir, ".local", "bin", "mise"),
		path.join(homedir, "bin", "mise"),
	];

	if (process.platform !== "win32") {
		commonPaths.push(
			path.join("/usr", "local", "bin", "mise"),
			path.join("/opt", "homebrew", "bin", "mise"),
		);
	}

	if (process.platform === "win32") {
		commonPaths.push(path.join(homedir, "scoop", "shims", "mise.exe"));
		commonPaths.push(
			path.join("C:", "ProgramData", "chocolatey", "bin", "mise.exe"),
		);
		commonPaths.push(path.join("C:", "Program Files", "mise", "mise.exe"));
		commonPaths.push(
			path.join(
				homedir,
				"AppData",
				"Local",
				"Microsoft",
				"WinGet",
				"Links",
				"mise.exe",
			),
		);
	}

	const allPaths = [...commonPaths];

	for (const binPath of allPaths) {
		if (await isUsableBinary(binPath)) {
			return binPath;
		}
	}

	throw new Error(
		"Could not find mise binary in any standard location (PATH, ~/.local/bin, ~/bin, /usr/local/bin, /opt/homebrew/bin...)",
	);
}

export async function isValidBinary(filepath: string): Promise<boolean> {
	try {
		const result = await safeExec(filepath, ["--help"]);
		return result.stdout.toLowerCase().includes("mise");
	} catch (error) {
		logger.info(
			`Path ${filepath} is not a valid mise binary: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return false;
}
