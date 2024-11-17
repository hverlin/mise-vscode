import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "./logger";

export function expandPath(filePath: string): string {
	return path.normalize(filePath).replace("~/", `${os.homedir()}/`);
}

export async function mkdirp(dirPath: string): Promise<void> {
	try {
		await fs.mkdir(dirPath, { recursive: true });
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code !== "EEXIST") {
			throw new Error(
				`Failed to create directory ${dirPath}: ${error.message}`,
			);
		}
	}
}

async function touchFile(filePath: string): Promise<void> {
	try {
		const parentDir = path.dirname(filePath);
		await mkdirp(parentDir);

		try {
			const handle = await fs.open(filePath, "wx");
			await handle.close();
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "EEXIST"
			) {
				return;
			}
			throw error;
		}
	} catch (error) {
		throw new Error(
			`Failed to create file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function setFilePermissions(filePath: string): Promise<void> {
	try {
		if (os.platform() === "win32") {
			// On Windows, TODO?
			return;
		}

		const mode = 0o755; // -rwxr-xr-x
		await fs.chmod(filePath, mode);
	} catch (error) {
		throw new Error(
			`Failed to set permissions on ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function isExecutable(filePath: string): Promise<boolean> {
	if (os.platform() === "win32") {
		return true;
	}

	try {
		const stats = await fs.stat(filePath);
		return !!(stats.mode & 0o111);
	} catch (error) {
		logger.info(`${filePath} is not executable: ${error}`);
	}
	return false;
}

export async function setupTaskFile(taskFilePath: string) {
	try {
		const normalizedDir = path.normalize(path.dirname(taskFilePath));
		const normalizedPath = path.normalize(taskFilePath);

		if (!path.isAbsolute(normalizedDir)) {
			throw new Error("Task directory must be an absolute path");
		}

		if (!normalizedPath.startsWith(normalizedDir)) {
			throw new Error("Task file must be within the task directory");
		}

		await mkdirp(normalizedDir);
		await touchFile(normalizedPath);
		await setFilePermissions(normalizedPath);
	} catch (error) {
		console.error("Error setting up task file:", error);
		throw error;
	}
}
