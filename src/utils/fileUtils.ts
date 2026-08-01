import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "./logger";

export const isWindows = os.platform() === "win32";

export function expandPath(filePath: string): string {
	const res = path
		.normalize(filePath)
		.replace(`~${path.sep}`, `${os.homedir()}${path.sep}`);
	if (isWindows) {
		return res.toLowerCase();
	}
	return res;
}

const SHEBANG_EXTENSIONS: Record<string, string> = {
	bash: "sh",
	sh: "sh",
	zsh: "sh",
	dash: "sh",
	ksh: "sh",
	fish: "fish",
	python: "py",
	node: "js",
	bun: "ts",
	deno: "ts",
	tsx: "ts",
	"ts-node": "ts",
	ruby: "rb",
	perl: "pl",
};

/** `#!/usr/bin/env python3` -> `py`, undefined when unknown */
export function getShebangFileExtension(content: string): string | undefined {
	const firstLine = content.split("\n", 1)[0] ?? "";
	if (!firstLine.startsWith("#!")) {
		return undefined;
	}

	const tokens = firstLine.slice(2).trim().split(/\s+/);
	let interpreter = path.basename(tokens[0] ?? "");
	if (interpreter === "env") {
		interpreter = tokens.find((t, i) => i > 0 && !t.startsWith("-")) ?? "";
	}
	// python3.12 -> python, node22 -> node
	const normalized = interpreter.replace(/[\d.]+$/, "") || interpreter;
	return SHEBANG_EXTENSIONS[normalized] ?? SHEBANG_EXTENSIONS[interpreter];
}

/**
 * File extension matching the language of a script, derived from its shebang
 * when the file has no extension. Used to pick a file icon for file tasks.
 */
export async function getScriptFileExtension(
	filePath: string,
): Promise<string | undefined> {
	if (path.extname(filePath)) {
		return undefined;
	}

	try {
		const content = await fs.readFile(filePath, "utf8");
		return getShebangFileExtension(content);
	} catch {
		return undefined;
	}
}

/**
 * Order of config sources in the tree views:
 * 0 = inside the workspace, 1 = parent of the workspace, 2 = global/other
 */
export function getSourceProximityRank(
	sourcePath: string,
	workspaceRoot: string | undefined,
): number {
	if (!workspaceRoot) {
		return 2;
	}
	const expandedSource = expandPath(sourcePath);
	const expandedRoot = expandPath(workspaceRoot);
	if (expandedSource.startsWith(expandedRoot + path.sep)) {
		return 0;
	}
	if (expandedRoot.startsWith(path.dirname(expandedSource) + path.sep)) {
		return 1;
	}
	return 2;
}

/**
 * Order config sources for the tree views: workspace sources first (with the
 * workspace root config before project configs), then parent configs, then
 * global ones.
 */
export function compareSourcePaths(
	sourceA: string,
	sourceB: string,
	workspaceRoot: string | undefined,
): number {
	const rankA = getSourceProximityRank(sourceA, workspaceRoot);
	const rankB = getSourceProximityRank(sourceB, workspaceRoot);
	if (rankA !== rankB) {
		return rankA - rankB;
	}

	const expandedA = expandPath(sourceA);
	const expandedB = expandPath(sourceB);
	const directoryCompare = path
		.dirname(expandedA)
		.localeCompare(path.dirname(expandedB));
	if (directoryCompare !== 0) {
		return directoryCompare;
	}
	return path.basename(expandedA).localeCompare(path.basename(expandedB));
}

export function displayPathRelativeTo(
	filePath: string,
	rootFolder: string | undefined,
) {
	const homedir = isWindows ? os.homedir().toLowerCase() : os.homedir();
	const rootPath = rootFolder ? `${rootFolder}${path.sep}` : "";
	const pathShown = expandPath(filePath)
		.replace(isWindows ? rootPath.toLowerCase() : rootPath, "")
		.replace(homedir, "~");
	return pathShown;
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
		if (isWindows) {
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
	if (isWindows) {
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

export async function setupMiseToml(taskFilePath: string) {
	try {
		const normalizedPath = path.normalize(taskFilePath);
		await touchFile(normalizedPath);
	} catch (error) {
		console.error("Error setting up file:", error);
		throw error;
	}
}
