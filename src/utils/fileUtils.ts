import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
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

/**
 * Inverse of {@link expandPath}: rewrites a path inside the home directory back
 * to its `~/` form. Returns undefined when the path is not below the home
 * directory (or already uses `~`), so callers can skip a redundant candidate.
 */
export function collapseHomePath(filePath: string): string | undefined {
	if (filePath.startsWith("~")) {
		return undefined;
	}
	const home = os.homedir();
	const prefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
	const compare = (value: string) => (isWindows ? value.toLowerCase() : value);
	if (!compare(filePath).startsWith(compare(prefix))) {
		return undefined;
	}
	// mise reports POSIX-style paths for bootstrap resources
	return `~/${filePath.slice(prefix.length).split(path.sep).join("/")}`;
}

/**
 * SHA-256 of a file, streamed so a large binary does not sit in memory.
 * Returns undefined when the file cannot be read.
 */
export async function hashFile(filePath: string): Promise<string | undefined> {
	try {
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(filePath)) {
			hash.update(chunk as Buffer);
		}
		return hash.digest("hex");
	} catch (error) {
		logger.info(`Unable to hash ${filePath}`, error);
		return undefined;
	}
}

/** Whether `filePath` sits inside `directory` (the directory itself excluded) */
export function isPathInside(directory: string, filePath: string): boolean {
	const normalize = (value: string) =>
		isWindows ? path.resolve(value).toLowerCase() : path.resolve(value);

	const relative = path.relative(normalize(directory), normalize(filePath));
	return (
		Boolean(relative) &&
		!relative.startsWith(`..${path.sep}`) &&
		relative !== ".." &&
		!path.isAbsolute(relative)
	);
}

/** Whether the value is a command name looked up in `PATH` rather than a file path */
export function isBareCommand(value: string): boolean {
	return !value.includes("/") && !value.includes("\\");
}

const isFile = (filePath: string) => {
	try {
		return statSync(filePath).isFile();
	} catch {
		return false;
	}
};

/**
 * Find the file that runs when a command name like `mise` is spawned.
 * Returns undefined when nothing is found.
 *
 * The lookup follows the rules of the system:
 * - on POSIX: each `PATH` directory, in order
 * - on Windows: the working directories (`cwds`) first, then each `PATH`
 *   directory, trying `mise.com` and `mise.exe`
 */
export function locateCommand(
	command: string,
	options: {
		/** Working directories the command may be spawned from */
		cwds?: readonly string[];
		pathEnv?: string;
		windows?: boolean;
		exists?: (filePath: string) => boolean;
	} = {},
): string | undefined {
	const {
		cwds = [],
		pathEnv = process.env.PATH ?? "",
		windows = isWindows,
		exists = isFile,
	} = options;

	const directories = [
		...(windows ? cwds : []),
		...pathEnv.split(path.delimiter).filter(Boolean),
	];
	// a name with an extension is tried as is, then `.com` and `.exe` are added
	const names = windows
		? [
				...(path.extname(command) ? [command] : []),
				`${command}.com`,
				`${command}.exe`,
			]
		: [command];

	for (const directory of directories) {
		for (const name of names) {
			const candidate = path.join(directory, name);
			if (exists(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

const WORKSPACE_FOLDER_VARIABLE = /^\$\{workspaceFolder(?::([^}]+))?\}[/\\]?/;

/**
 * Resolve a configured binary path (`mise.binPath`) that may reference the
 * workspace: `${workspaceFolder}`/`${workspaceFolder:folderName}` variables
 * and relative paths like `./bin/mise` are resolved against the workspace
 * folders (the first folder where the file exists wins). Bare command names
 * without a path separator (e.g. `mise`) are left untouched so they are
 * looked up in `PATH`.
 */
export function resolveConfiguredBinPath(
	configuredPath: string,
	workspaceFolders: readonly { name: string; fsPath: string }[],
	exists: (filePath: string) => boolean = existsSync,
): string {
	const variableMatch = configuredPath.match(WORKSPACE_FOLDER_VARIABLE);

	if (variableMatch) {
		const [prefix, folderName] = variableMatch;
		const folders = folderName
			? workspaceFolders.filter((folder) => folder.name === folderName)
			: workspaceFolders;

		const candidates = folders.map((folder) =>
			path.join(folder.fsPath, configuredPath.slice(prefix.length)),
		);

		return (
			candidates.find((candidate) => exists(candidate)) ??
			candidates[0] ??
			configuredPath
		);
	}

	if (configuredPath.startsWith("~/") || configuredPath.startsWith("~\\")) {
		return path.join(os.homedir(), configuredPath.slice(2));
	}

	if (
		path.isAbsolute(configuredPath) ||
		(!configuredPath.includes("/") && !configuredPath.includes("\\"))
	) {
		return configuredPath;
	}

	const candidates = workspaceFolders.map((folder) =>
		path.resolve(folder.fsPath, configuredPath),
	);

	return (
		candidates.find((candidate) => exists(candidate)) ??
		candidates[0] ??
		configuredPath
	);
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

/**
 * Create an executable task file at `taskFilePath`, which must stay inside
 * `taskDir`. The containment check needs the intended directory: comparing the
 * path against its own `dirname` can never fail and lets a name such as
 * `../../x` write anywhere.
 */
export async function setupTaskFile(taskFilePath: string, taskDir: string) {
	try {
		const normalizedDir = path.normalize(taskDir);
		const normalizedPath = path.normalize(taskFilePath);

		if (!path.isAbsolute(normalizedDir)) {
			throw new Error("Task directory must be an absolute path");
		}

		// nested task files are supported, escaping the directory is not
		const relative = path.relative(normalizedDir, normalizedPath);
		if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error("Task file must be within the task directory");
		}

		await mkdirp(path.dirname(normalizedPath));
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
