import { existsSync } from "node:fs";
import { readlink, realpath, rm, symlink } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { createCache } from "async-cache-dedupe";
import { parse } from "toml-v1";
import * as vscode from "vscode";
import { MISE_RELOAD } from "./commands";
import {
	CONFIGURATION_FLAGS,
	getCommandTTLCacheSeconds,
	getConfiguredBinPath,
	getConfiguredSymLinksFolder,
	getCurrentWorkspaceFolderPath,
	getMiseEnv,
	isBinPathSetByWorkspace,
	isMiseExtensionEnabled,
	shouldCheckForNewMiseVersion,
	shouldResolveMonorepoProjectConfigs,
	shouldSkipWorkspaceBinaryApproval,
	updateBinPath,
} from "./configuration";
import { expandPath, hashFile, isWindows, mkdirp } from "./utils/fileUtils";
import { uniqBy } from "./utils/fn";
import { logger } from "./utils/logger";
import {
	resolveMisePath,
	WorkspaceBinaryNotApprovedError,
} from "./utils/miseBinLocator";
import { expandConfig } from "./utils/miseDoctorParser";
import {
	flattenJsonSchema,
	idiomaticFiles,
	idiomaticFileToTool,
	isToolVersionsFile,
} from "./utils/miseUtilts";
import { showSettingsNotification } from "./utils/notify";
import {
	buildProjectsData,
	configsFromLsAllSources,
	findMiseConfigsInDir,
	type MiseLsAllSourcesOutput,
	parseToolVersionsContent,
} from "./utils/projectsUtils";
import {
	buildShellCommand,
	isTerminalClosed,
	runInVscodeTerminal,
	safeExec,
} from "./utils/shell";
import {
	type MiseTaskInfo,
	parseTaskInfo,
	parseTaskInfoJson,
} from "./utils/taskInfoParser";
import { getConfigRootPaths } from "./utils/taskNames";

// https://github.com/jdx/mise/blob/main/src/env.rs
const XDG_STATE_HOME =
	process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
const STATE_DIR =
	process.env.MISE_STATE_DIR ?? path.join(XDG_STATE_HOME, "mise");
const TRACKED_CONFIG_DIR = path.join(STATE_DIR, "tracked-configs");

/** globalState key holding the workspace mise binaries the user approved */
export const APPROVED_WORKSPACE_BINARIES_KEY = "mise.approvedWorkspaceBinaries";

/** globalState key holding the folders scanned for the Projects webview */
export const PROJECT_SCAN_DIRECTORIES_KEY = "mise.projectScanDirectories";

const flattenSettings = (obj: object, prefix = "") => {
	const result: Record<string, MiseSettingInfo> = {};

	for (const [key, value] of Object.entries(obj)) {
		const newKey = prefix ? `${prefix}.${key}` : key;

		if (value && typeof value === "object" && !("value" in value)) {
			Object.assign(result, flattenSettings(value, newKey));
		} else {
			result[newKey] = value;
		}
	}

	return result;
};

const MIN_MISE_VERSION = [2025, 1, 5] as const;
// `mise bootstrap` (with `bootstrap status --json`) was consolidated in 2026.7.16
const MIN_MISE_VERSION_FOR_BOOTSTRAP = [2026, 7, 16] as const;

function compareVersions(
	a: readonly [number, number, number],
	b: readonly [number, number, number],
) {
	for (let i = 0; i < a.length; i++) {
		// @ts-expect-error
		if (a[i] > b[i]) {
			return 1;
		}
		// @ts-expect-error
		if (a[i] < b[i]) {
			return -1;
		}
	}
	return 0;
}

function isVersionGreaterOrEqualThan(
	version: readonly [number, number, number],
	target: readonly [number, number, number],
) {
	return compareVersions(version, target) >= 0;
}

function ensureMiseCommand(
	miseCommand: string | undefined,
): asserts miseCommand {
	if (!miseCommand) {
		throw new Error(
			"Mise binary path is not configured. [Install mise](https://mise.jdx.dev/getting-started.html)",
		);
	}
}

export class MiseService {
	private readonly context: vscode.ExtensionContext;
	private readonly eventEmitter: vscode.EventEmitter<void>;
	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.eventEmitter = new vscode.EventEmitter();
	}

	subscribeToReloadEvent(listener: () => void): vscode.Disposable {
		return this.eventEmitter.event(listener);
	}

	private hasVerifiedMiseVersion = false;
	private _hasValidMiseBinPath = false;
	private invalidMisePathErrorShown = false;
	get hasValidMiseBinPath(): boolean {
		return this._hasValidMiseBinPath;
	}

	private terminals: Map<string, vscode.Terminal | undefined> = new Map();

	getCurrentWorkspaceFolderPath() {
		return getCurrentWorkspaceFolderPath(this.context);
	}

	private dedupeCache = createCache({
		ttl: 0,
		storage: { type: "memory" },
	}).define("execCmd", ({ args, setMiseEnv } = {}) =>
		this.execMiseCommand(args, { setMiseEnv }),
	);

	private cache = createCache({
		ttl: getCommandTTLCacheSeconds(),
		storage: { type: "memory" },
	}).define("execCmd", ({ args, setMiseEnv } = {}) =>
		this.execMiseCommand(args, { setMiseEnv }),
	);

	private slowCache = createCache({
		ttl: 60,
		storage: { type: "memory" },
	}).define("execCmd", ({ args, setMiseEnv } = {}) =>
		this.execMiseCommand(args, { setMiseEnv }),
	);

	private longTTLCache = createCache({
		ttl: 60,
		storage: { type: "memory" },
	})
		.define("execCmd", ({ args, setMiseEnv } = {}) =>
			this.execMiseCommand(args, { setMiseEnv }),
		)
		.define("fetchSchema", async () => {
			const res = await fetch("https://mise.jdx.dev/schema/mise.json");
			if (!res.ok) {
				logger.warn(
					`Failed to fetch Mise schema (status: ${res.status})`,
					await res.text().catch(() => "Unknown error"),
				);
				return [];
			}
			const json = await res.json();
			return flattenJsonSchema(json.$defs.settings);
		});

	// scanning the project directories reads many files: keep the result for a
	// while instead of re-walking on every webview refresh
	private projectsCache = createCache({
		ttl: 60,
		storage: { type: "memory" },
	}).define("getProjects", () => this.loadProjectEntries());

	async invalidateCache() {
		await Promise.all([
			this.dedupeCache.clear(),
			this.slowCache.clear(),
			this.cache.clear(),
			this.longTTLCache.clear(),
			this.projectsCache.clear(),
		]);
		this.eventEmitter.fire();
	}

	async initializeMisePath() {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		let miseBinaryPath = "mise";
		const previousPath = getConfiguredBinPath();

		try {
			miseBinaryPath = await resolveMisePath({
				// every folder counts, not only the selected one: a relative
				// binPath resolves against whichever folder holds the file
				workspaceRoots:
					vscode.workspace.workspaceFolders?.map(
						(folder) => folder.uri.fsPath,
					) ?? [],
				confirmWorkspaceBinary: (binPath) =>
					this.confirmWorkspaceBinary(binPath),
			});
			if (previousPath !== miseBinaryPath) {
				logger.info(`Mise binary path resolved to: ${miseBinaryPath}`);
				await updateBinPath(miseBinaryPath);
				if (previousPath) {
					void showSettingsNotification(
						`Mise binary path has been updated to: ${miseBinaryPath}`,
						{ settingsKey: "mise.binPath", type: "info" },
					);
				}
			}
		} catch (error) {
			if (error instanceof WorkspaceBinaryNotApprovedError) {
				// no fallback on purpose: the extension stays idle until the user
				// reviews the binary, instead of quietly using a different mise
				logger.info(error.message);
				this._pendingBinaryApproval = error.binPath;
				this._hasValidMiseBinPath = false;
				return;
			}

			if (!this.invalidMisePathErrorShown) {
				void showSettingsNotification(
					"Invalid configured mise bin path. Please configure the binary path.",
					{ settingsKey: "mise.binPath", type: "error" },
				);
				this.invalidMisePathErrorShown = true;
			}
			logger.info("Failed to resolve mise binary path", error);
			this._hasValidMiseBinPath = false;
			return;
		}

		this._pendingBinaryApproval = undefined;
		this._hasValidMiseBinPath = true;
		if (!this.hasVerifiedMiseVersion) {
			const version = await this.getVersion();
			if (!version || version.includes("not configured")) {
				return;
			}
			const hasValidMiseVersion = await this.hasValidMiseVersion();
			if (!hasValidMiseVersion) {
				const canSelfUpdate = await this.canSelfUpdate();

				const selection = await vscode.window.showErrorMessage(
					`Mise version ${version} is not supported. Please update to a supported version.`,
					{ modal: true },
					canSelfUpdate ? "Run mise self-update" : "open mise website",
				);
				this.hasVerifiedMiseVersion = true;
				if (selection === "Run mise self-update") {
					await this.runMiseToolActionInConsole(["self-update", "-y"]);
				}
				if (selection === "open mise website") {
					await vscode.env.openExternal(
						vscode.Uri.parse("https://mise.jdx.dev/installing-mise.html"),
					);
				}
			}
		}
	}

	/** Paths refused in this window, so a reload does not ask again */
	private readonly refusedWorkspaceBinaries = new Set<string>();

	private _pendingBinaryApproval: string | undefined;

	/** Set while a workspace mise binary is waiting for the user's decision */
	get pendingBinaryApproval(): string | undefined {
		return this._pendingBinaryApproval;
	}

	/** Ask about the refused binary again, for the "review" status bar entry */
	async reviewWorkspaceBinary(): Promise<void> {
		if (this._pendingBinaryApproval) {
			this.refusedWorkspaceBinaries.delete(this._pendingBinaryApproval);
		}
	}

	private getApprovedWorkspaceBinaries(): Record<string, string> {
		return this.context.globalState.get<Record<string, string>>(
			APPROVED_WORKSPACE_BINARIES_KEY,
			{},
		);
	}

	/** Approved workspace binaries, for the revoke command */
	listApprovedWorkspaceBinaries(): string[] {
		return Object.keys(this.getApprovedWorkspaceBinaries()).sort();
	}

	/** Drop stored approvals so the next resolution asks again */
	async revokeWorkspaceBinaryApprovals(binPaths: string[]): Promise<void> {
		const approved = { ...this.getApprovedWorkspaceBinaries() };
		for (const binPath of binPaths) {
			delete approved[binPath];
			this.refusedWorkspaceBinaries.delete(binPath);
		}
		await this.context.globalState.update(
			APPROVED_WORKSPACE_BINARIES_KEY,
			approved,
		);
	}

	/**
	 * A mise binary living in the workspace is code shipped by the repository:
	 * running it is the repository's code running, so it is approved once by
	 * the user and the answer is remembered across windows.
	 *
	 * The approval is tied to the contents of the binary, not only to its path,
	 * so a project that swaps the file after being approved has to ask again.
	 */
	private async confirmWorkspaceBinary(binPath: string): Promise<boolean> {
		// opt-out for projects that ship a launcher on purpose, e.g. the script
		// written by `mise generate bootstrap -l -w`. Machine scoped, so this is
		// the user's own decision and never the project's.
		if (shouldSkipWorkspaceBinaryApproval()) {
			logger.info(
				`Running the workspace mise binary without approval, ${CONFIGURATION_FLAGS.skipWorkspaceBinaryApproval} is enabled: ${binPath}`,
			);
			return true;
		}

		if (this.refusedWorkspaceBinaries.has(binPath)) {
			return false;
		}

		const approved = this.getApprovedWorkspaceBinaries();
		const currentHash = await hashFile(binPath);
		const approvedHash = approved[binPath];

		if (currentHash && approvedHash === currentHash) {
			return true;
		}

		const changedSinceApproval = Boolean(approvedHash && currentHash);
		if (changedSinceApproval) {
			logger.info(`The approved mise binary changed on disk: ${binPath}`);
		}

		const allow = "Allow and run it";
		const inspectSettings = "Inspect settings.json";

		const setByWorkspace = isBinPathSetByWorkspace();
		const origin = setByWorkspace
			? "This path is set by this project's own .vscode/settings.json, not by your user settings. Inspect that file before allowing it."
			: "This path comes from your own settings.";

		const title = changedSinceApproval
			? "The mise binary of this workspace changed since you approved it."
			: "This workspace is configured to use a mise binary from the project folder.";

		const selection = await vscode.window.showWarningMessage(
			title,
			{
				modal: true,
				detail: `${binPath}\n\n${origin}\n\nRunning it executes a program shipped with this project, not the mise installed on your machine. Only allow this if you trust the project.`,
			},
			...(setByWorkspace ? [inspectSettings, allow] : [allow]),
		);

		if (selection === inspectSettings) {
			await vscode.commands.executeCommand(
				"workbench.action.openWorkspaceSettingsFile",
			);
			this.refusedWorkspaceBinaries.add(binPath);
			return false;
		}

		if (selection !== allow) {
			this.refusedWorkspaceBinaries.add(binPath);
			return false;
		}

		if (!currentHash) {
			// an unreadable binary cannot be pinned, so it is not remembered
			logger.warn(`Approved ${binPath} but it could not be hashed`);
			return true;
		}

		await this.context.globalState.update(APPROVED_WORKSPACE_BINARIES_KEY, {
			...approved,
			[binPath]: currentHash,
		});
		return true;
	}

	/**
	 * Run mise and return its output. Arguments are passed as an argv array and
	 * never go through a shell, they may contain any character.
	 */
	async execMiseCommand(args: string[], { setMiseEnv = true } = {}) {
		const miseBinaryPath = this.getMiseBinaryPath();
		ensureMiseCommand(miseBinaryPath);

		const miseArgs = this.buildMiseArgs(args, { setMiseEnv });
		logger.debug(`> ${miseBinaryPath} ${miseArgs.join(" ")}`);

		const { code, stdout, stderr } = await safeExec(miseBinaryPath, miseArgs, {
			cwd: this.getCurrentWorkspaceFolderPath(),
		});

		if (code !== 0) {
			throw new Error(
				`Command failed: mise ${miseArgs.join(" ")}\n${stderr}`.trim(),
			);
		}

		return { stdout, stderr };
	}

	/** Same as {@link execMiseCommand}, but never throws */
	private async execMiseCommandMergeOutput(
		args: string[],
		{ setMiseEnv = true } = {},
	) {
		const miseBinaryPath = this.getMiseBinaryPath();
		if (!miseBinaryPath) {
			return { stdout: "", stderr: "" };
		}

		const { stdout, stderr } = await safeExec(
			miseBinaryPath,
			this.buildMiseArgs(args, { setMiseEnv }),
			{ cwd: this.getCurrentWorkspaceFolderPath() },
		);
		return { stdout, stderr };
	}

	async runMiseToolActionInConsole(
		args: string[],
		taskName?: string,
	): Promise<void> {
		try {
			const miseBinaryPath = this.getMiseBinaryPath();
			if (!miseBinaryPath) {
				logger.warn("Could not find mise binary");
				return;
			}

			const miseArgs = this.buildMiseArgs(args);
			logger.info(`> ${miseBinaryPath} ${miseArgs.join(" ")}`);

			// the arguments are quoted here rather than by vscode: its own
			// `ShellQuoting.Strong` does not escape quotes inside the value
			const execution = new vscode.ShellExecution(
				buildShellCommand(miseBinaryPath, miseArgs),
			);
			const task = new vscode.Task(
				{ type: "mise" },
				vscode.TaskScope.Workspace,
				taskName ?? `mise ${args.join(" ")}`,
				"mise",
				execution,
			);

			const p = new Promise((resolve) => {
				const disposable = vscode.tasks.onDidEndTask((e) => {
					if (e.execution.task === task) {
						vscode.commands.executeCommand(MISE_RELOAD);
						disposable.dispose();
						resolve(undefined);
					}
				});
			});
			await vscode.tasks.executeTask(task);
			return p as Promise<void>;
		} catch (error) {
			logger.error(`Failed to execute ${taskName}: ${error}`);
		}
	}

	public getMiseBinaryPath(): string | undefined {
		if (!this._hasValidMiseBinPath) {
			return;
		}

		return getConfiguredBinPath();
	}

	/** Arguments of a mise invocation, with the configured environment applied */
	public buildMiseArgs(args: string[], { setMiseEnv = true } = {}): string[] {
		const miseEnv = getMiseEnv();
		const isUsePath = args[0] === "use" && args.includes("--path");
		if (!miseEnv || !setMiseEnv || isUsePath) {
			return args;
		}
		return ["--env", miseEnv, ...args];
	}

	/**
	 * Command line running mise in a terminal. Only for the places that need a
	 * shell command, prefer {@link execMiseCommand} everywhere else.
	 */
	public createMiseCommand(
		args: string[],
		{ setMiseEnv = true } = {},
	): string | undefined {
		const miseBinaryPath = this.getMiseBinaryPath();
		if (!miseBinaryPath) {
			return undefined;
		}

		return buildShellCommand(
			miseBinaryPath,
			this.buildMiseArgs(args, { setMiseEnv }),
		);
	}

	private async handleUntrustedFile(error: Error): Promise<void> {
		const trustAction = "Trust";
		logger.info("Untrusted file error:", error);
		const selection = await vscode.window.showErrorMessage(
			"Do you trust the Mise configuration file in the current project?",
			{ modal: true },
			trustAction,
		);

		if (selection !== trustAction) {
			throw new Error("User declined to trust file");
		}

		try {
			await this.cache.execCmd({ args: ["trust"] });
		} catch (trustError) {
			logger.error("Error trusting mise configuration:", trustError as Error);
			throw new Error(
				`Failed to trust the Mise configuration. "${error}". Please try again or trust it manually.`,
			);
		}
	}

	async miseTrust() {
		if (!this.getMiseBinaryPath()) {
			return;
		}
		await this.cache.execCmd({ args: ["trust"], setMiseEnv: false });
	}

	private async buildTasksLsArgs({ includeHidden = false } = {}) {
		const args = ["tasks", "ls", "--json"];

		if (includeHidden) {
			args.push("--hidden");
		}

		// --all (added in 2025.10.3) loads tasks from every monorepo project
		if (await this.hasValidMiseVersion([2025, 10, 3])) {
			args.push("--all");
		}

		return args;
	}

	async getTasks(
		{ includeHidden }: { includeHidden?: boolean } = {
			includeHidden: false,
		},
	): Promise<MiseTask[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
				args: await this.buildTasksLsArgs({ includeHidden }),
			});
			return JSON.parse(stdout);
		} catch (error: unknown) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				await this.handleUntrustedFile(error);
				return this.getTasks();
			}

			logger.info("Error fetching mise tasks:", error as Error);
			return [];
		}
	}

	async getAllCachedTasks(): Promise<MiseTask[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.slowCache.execCmd({
			args: await this.buildTasksLsArgs({ includeHidden: true }),
		});
		return JSON.parse(stdout);
	}

	async getAllCachedTasksSources(): Promise<string[]> {
		const tasks = await this.getAllCachedTasks();
		return [...new Set(tasks.map((task) => task.source))];
	}

	async getCurrentConfigFiles(): Promise<string[]> {
		const files = await Promise.all([
			this.getTasks().then((tasks) => tasks.map((task) => task.source)),
			this.getMiseConfigFiles().then((files) => files.map((file) => file.path)),
		]);

		return [...new Set(files.flat().map((file) => expandPath(file)))];
	}

	async getTaskInfo(taskName: string): Promise<MiseTaskInfo | undefined> {
		if (!this.getMiseBinaryPath()) {
			return undefined;
		}

		try {
			const { stdout } = await this.execMiseCommand([
				"tasks",
				"info",
				"--json",
				taskName,
			]);
			return parseTaskInfoJson(stdout);
		} catch (error: unknown) {
			logger.info(
				"Error fetching mise task info as json, falling back to text output:",
				error as Error,
			);
		}

		try {
			const { stdout } = await this.execMiseCommand([
				"tasks",
				"info",
				taskName,
			]);
			return parseTaskInfo(stdout);
		} catch (error: unknown) {
			logger.info("Error fetching mise task info:", error as Error);
			return undefined;
		}
	}

	async getCurrentTools({
		useCache = true,
		local = false,
		configRootPath = undefined,
	}: {
		useCache?: boolean;
		local?: boolean;
		/** Resolve tools from this directory instead of the workspace root (monorepo project) */
		configRootPath?: string;
	} = {}): Promise<Array<MiseTool>> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const cacheInstance = useCache ? this.cache : this.dedupeCache;
			const { stdout } = await cacheInstance.execCmd({
				args: [
					...(configRootPath ? ["-C", configRootPath] : []),
					"ls",
					local ? "--local" : "--current",
					"--offline",
					"--json",
				],
			});

			return Object.entries(JSON.parse(stdout)).flatMap(([toolName, tools]) => {
				return (tools as MiseTool[]).map((tool) => {
					return {
						name: toolName,
						version: tool.version,
						requested_version: tool.requested_version,
						active: tool.active,
						installed: tool.installed,
						install_path: tool.install_path,
						source: tool.source,
					} satisfies MiseTool;
				});
			});
		} catch (error) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				await this.handleUntrustedFile(error);
				return this.getCurrentTools();
			}

			return [];
		}
	}

	async getAllTools(): Promise<Array<MiseTool>> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
				args: ["ls", "--offline", "--json"],
			});
			return Object.entries(JSON.parse(stdout)).flatMap(([toolName, tools]) => {
				return (tools as MiseTool[]).map((tool) => {
					return {
						name: toolName,
						version: tool.version,
						requested_version: tool.requested_version,
						active: tool.active,
						installed: tool.installed,
						install_path: tool.install_path,
						source: tool.source,
					} satisfies MiseTool;
				});
			});
		} catch (error) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				await this.handleUntrustedFile(error);
				return this.getAllTools();
			}

			logger.info("Error fetching mise tools:", error as Error);
			return [];
		}
	}

	async getOutdatedTools({
		bump = false,
	} = {}): Promise<Array<MiseToolUpdate>> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		// --bump is only requested explicitly (button click), so bypass the TTL
		// cache to make sure a new check is performed each time
		const { stdout } = bump
			? await this.dedupeCache.execCmd({
					args: ["outdated", "--bump", "--json"],
				})
			: await this.cache.execCmd({ args: ["outdated", "--json"] });

		if (!stdout) {
			return [];
		}

		return Object.entries(JSON.parse(stdout)).map(([toolName, tool]) => {
			const foundTool = tool as {
				name: string;
				requested: string;
				current: string;
				latest: string | null;
				bump: string | null;
				source: { type: string; path: string };
			};

			return {
				name: toolName,
				version: foundTool.current,
				requested_version: foundTool.requested,
				source: foundTool.source,
				latest: foundTool.latest,
				bump: foundTool.bump,
			};
		});
	}

	async rmUseTool(filename: string, toolName: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		const cmd = ["use"];
		if (filename) {
			const normalizedPath = isWindows
				? filename.replace(/\\/g, "/").replace(/^\//, "")
				: filename;

			cmd.push("--path", normalizedPath);
		}
		cmd.push("--rm");
		cmd.push(toolName);
		await this.runMiseToolActionInConsole(cmd);
	}

	async removeToolInConsole(toolName: string, version?: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole([
			"uninstall",
			version ? `${toolName}@${version}` : toolName,
		]);
	}

	async getEnvs(): Promise<MiseEnv[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
				args: ["env", "--json"],
			});
			return Object.entries(JSON.parse(stdout)).map(([key, value]) => ({
				name: key,
				value: value as string,
			}));
		} catch (error) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				await this.handleUntrustedFile(error);
				return this.getEnvs();
			}

			logger.info("Error fetching mise environments:", error as Error);
			return [];
		}
	}

	async getEnvWithInfo({
		configRootPath = undefined,
	}: {
		/** Resolve envs from this directory instead of the workspace root (monorepo project) */
		configRootPath?: string;
	} = {}) {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.cache.execCmd({
			args: [
				...(configRootPath ? ["-C", configRootPath] : []),
				"env",
				"--json-extended",
			],
		});

		const parsed = JSON.parse(stdout) as Record<string, MiseEnvWithInfo>;
		return Object.entries(parsed).map(([key, info]) => ({
			name: key,
			value: info.value ?? "",
			tool: info?.tool,
			source: info?.source ? expandPath(info.source) : undefined,
		}));
	}

	/** Absolute paths of the monorepo config roots, empty outside of a monorepo */
	async getMonorepoConfigRootPaths(): Promise<string[]> {
		// resolving project configs spawns one mise process per project
		if (!shouldResolveMonorepoProjectConfigs()) {
			return [];
		}

		const workspaceRoot = this.getCurrentWorkspaceFolderPath();
		if (!workspaceRoot) {
			return [];
		}

		const tasks = await this.getAllCachedTasks();
		return getConfigRootPaths(tasks).map((configRoot) =>
			expandPath(path.join(workspaceRoot, configRoot)),
		);
	}

	/**
	 * Root tools plus the ones defined by monorepo projects. Project tools are
	 * not visible from the workspace root, they require resolving with `-C`.
	 */
	async getCurrentToolsIncludingMonorepo(): Promise<Array<MiseTool>> {
		const [rootTools, configRootPaths] = await Promise.all([
			this.getCurrentTools(),
			this.getMonorepoConfigRootPaths(),
		]);

		if (!configRootPaths.length) {
			return rootTools;
		}

		const projectTools = await Promise.all(
			configRootPaths.map(async (configRootPath) => {
				const tools = await this.getCurrentTools({ configRootPath }).catch(
					() => [] as MiseTool[],
				);
				// the rest is already reported by the workspace root
				return tools.filter((tool) =>
					tool.source?.path
						? expandPath(tool.source.path).startsWith(configRootPath)
						: false,
				);
			}),
		);

		return uniqBy(
			[...rootTools, ...projectTools.flat()],
			(tool) =>
				`${tool.name}|${tool.requested_version}|${tool.source?.path ?? ""}`,
		);
	}

	/** Envs defined by each project, they only apply within the project directory */
	async getMonorepoProjectEnvs() {
		const configRootPaths = await this.getMonorepoConfigRootPaths();

		const projectEnvs = await Promise.all(
			configRootPaths.map(async (configRootPath) => {
				const envs = await this.getEnvWithInfo({ configRootPath }).catch(
					() => [] as MiseEnvWithInfo[],
				);
				return {
					configRootPath,
					envs: envs.filter((env) =>
						env.source ? env.source.startsWith(configRootPath) : false,
					),
				};
			}),
		);

		return projectEnvs.filter((project) => project.envs.length > 0);
	}

	/** Envs of the workspace root plus the ones defined by monorepo projects */
	async getEnvWithInfoIncludingMonorepo() {
		const [rootEnvs, projectEnvs] = await Promise.all([
			this.getEnvWithInfo(),
			this.getMonorepoProjectEnvs(),
		]);

		return uniqBy(
			[...rootEnvs, ...projectEnvs.flatMap((project) => project.envs)],
			(env) => `${env.name}|${env.value}|${env.source ?? ""}`,
		);
	}

	async miseFmt() {
		await this.execMiseCommand(["fmt"], { setMiseEnv: false });
	}

	async runTask(taskName: string, ...args: string[]): Promise<void> {
		const terminal = this.getOrCreateTerminal(`run ${taskName}`);
		terminal.show();

		const command = this.createMiseCommand(["run", taskName, ...args]);
		ensureMiseCommand(command);
		await runInVscodeTerminal(terminal, command);
	}

	async watchTask(taskName: string, ...args: string[]): Promise<void> {
		const terminalName = `watch ${taskName}`;
		const previousTerminal = this.terminals.get(terminalName);
		if (previousTerminal) {
			previousTerminal.dispose();
			this.terminals.delete(terminalName);
		}
		const terminal = this.getOrCreateTerminal(terminalName);
		terminal.show();
		const command = this.createMiseCommand(["watch", taskName, ...args]);
		ensureMiseCommand(command);
		await runInVscodeTerminal(terminal, command);
	}

	private getOrCreateTerminal(name: string): vscode.Terminal {
		let terminal = this.terminals.get(name);
		if (!terminal || isTerminalClosed(terminal)) {
			terminal = vscode.window.createTerminal({
				name,
				cwd: this.getCurrentWorkspaceFolderPath(),
			});

			vscode.window.onDidCloseTerminal((closedTerminal) => {
				if (closedTerminal === terminal) {
					terminal = undefined;
					this.terminals.delete(name);
				}
			});
		}
		this.terminals.set(name, terminal);
		return terminal;
	}

	async binPaths(name: string) {
		const { stdout } = await this.cache.execCmd({
			args: ["bin-paths", name],
		});
		return stdout.trim().split("\n");
	}

	async which(name: string): Promise<string | undefined> {
		try {
			const { stdout } = await this.cache.execCmd({ args: ["which", name] });

			const out = stdout.trim();
			if (out === "") {
				return undefined;
			}

			return out;
		} catch (e) {
			if (!(e as Error)?.message?.includes("it is not currently active")) {
				logger.info(`Error running which ${name}`, e);
			}
			return undefined;
		}
	}

	async getAllBinsForTool(toolName: string) {
		const binDirs = await this.binPaths(toolName);
		return (
			await Promise.all(
				binDirs.map(async (binDir) => {
					try {
						const files = await vscode.workspace.fs.readDirectory(
							vscode.Uri.file(binDir),
						);
						return files.map(([name]) => path.join(binDir, name));
					} catch (e) {
						logger.info(`Error reading bin path: ${binDir}`, e as Error);
						return [];
					}
				}),
			)
		).flat();
	}

	async miseVersion() {
		const { stdout } = await this.cache.execCmd({
			args: ["version", "--json"],
		});

		const version = JSON.parse(stdout) as MiseVersion;
		// "version": "2025.3.2 windows-x64 (2025-03-07)",
		const current = version.version.split(" ")[0] ?? "";
		return {
			raw: version,
			latest: version.latest,
			current: current,
			newVersionAvailable: !!version.latest && version.latest !== current,
		};
	}

	async getMiseConfiguration(): Promise<MiseConfig> {
		const { stdout, stderr } = await this.execMiseCommandMergeOutput(
			["doctor", "--json"],
			{ setMiseEnv: false },
		);
		if (stderr) {
			logger.debug("mise doctor --json", stderr);
		}

		try {
			const miseConfig = JSON.parse(stdout) as MiseConfig;
			return expandConfig(miseConfig);
		} catch (error) {
			logger.error(`Error parsing mise configuration: ${stdout}`, error);
			return {} as MiseConfig;
		}
	}

	async miseDoctor() {
		const { stdout, stderr } = await this.execMiseCommandMergeOutput(
			["doctor"],
			{ setMiseEnv: false },
		);
		return `${stdout}\n${stderr}`;
	}

	async getMiseConfigFiles() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.cache.execCmd({
			args: ["config", "ls", "--json"],
		});
		return JSON.parse(stdout) as Array<{
			path: string;
			tools: string[];
		}>;
	}

	async getMiseTomlConfigFilePathsEvenIfMissing() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const configFiles = new Set<string>();
		configFiles.add(
			expandPath(
				path.join(this.getCurrentWorkspaceFolderPath() || "", "mise.toml"),
			),
		);
		configFiles.add(
			expandPath(path.join(os.homedir(), ".config", "mise", "config.toml")),
		);

		const miseConfigs = (await this.getMiseConfigFiles())
			.map((file) => expandPath(file.path))
			.filter((path) => path.endsWith(".toml"));

		for (const file of miseConfigs) {
			configFiles.add(expandPath(file));
		}

		return Array.from(configFiles);
	}

	async miseReshim() {
		await this.execMiseCommand(["reshim"], { setMiseEnv: false }).catch(
			(error) => {
				logger.info("mise reshim", error as Error);
			},
		);
	}

	async getVersion() {
		if (!this.getMiseBinaryPath()) {
			return "";
		}

		const { stdout, stderr } = await this.execMiseCommandMergeOutput(
			["version"],
			{ setMiseEnv: false },
		);
		if (stderr) {
			if (stderr.includes("run mise self-update")) {
				logger.debug(`Mise version stderr: ${stderr.trim()}`);
			} else {
				logger.info(`Mise version stderr: ${stderr.trim()}`);
			}
		}
		return stdout.trim();
	}

	async getParsedMiseVersion() {
		const version = await this.getVersion();
		const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
		if (!match) {
			return undefined;
		}

		const [, year, minor, patch] = match.map((n) =>
			n ? Number.parseInt(n, 10) : 0,
		);
		return [year, minor, patch] as [number, number, number];
	}

	// Checks whether the mise binary can self-update.
	async canSelfUpdate() {
		if (!this.getMiseBinaryPath()) {
			return false;
		}

		const miseConfig = await this.getMiseConfiguration();
		if (miseConfig.self_update_available != null) {
			logger.debug(
				"self_update_available value from mise dr:",
				miseConfig.self_update_available,
			);
			return miseConfig.self_update_available;
		}

		const isSelfUpdateDisabled = await this.isSelfUpdateDisabled();
		return !isSelfUpdateDisabled;
	}

	// Checks for the presence of the `.disable-self-update` sentinel file in the Mise lib
	// dir, to determine if self-update is disabled (ie installed using a package manager).
	// It's a re-implementation of the `is_available()` function from `SelfUpdate`.
	// https://github.com/jdx/mise/blob/863505d4089126780c2352fb1218c6550c3cf9d8/src/cli/self_update.rs#L100
	async isSelfUpdateDisabled(): Promise<boolean> {
		logger.info("Checking if self-update is disabled...");

		try {
			const miseBinPath = this.getMiseBinaryPath();
			logger.info(`miseBinPath: ${miseBinPath}`);
			if (!miseBinPath) {
				return false; // Default to allowing self-update if we can't determine the path
			}

			// Get canonical path of the mise binary
			const canonicalPath = await realpath(miseBinPath);

			// Get parent directory, then parent of that (two levels up)
			const parentDir = path.dirname(canonicalPath);
			const grandParentDir = path.dirname(parentDir);

			// Check for sentinel files that disable self-update
			const disablePaths = [
				path.join(grandParentDir, "lib", ".disable-self-update"), // kept for compatibility
				path.join(grandParentDir, "lib", "mise", ".disable-self-update"),
			];

			for (const disablePath of disablePaths) {
				if (existsSync(disablePath)) {
					logger.info(`Self-update disabled by sentinel file: ${disablePath}`);
					return true;
				}
			}

			return false;
		} catch (error) {
			// If filesystem operations fail, fall back to allowing self-update
			logger.debug(`Failed to check for self-update disable files: ${error}`);
			return false;
		}
	}

	async hasValidMiseVersion(minVersion?: readonly [number, number, number]) {
		if (!this.getMiseBinaryPath()) {
			return false;
		}

		const version = await this.getParsedMiseVersion();
		if (!version) {
			return false;
		}

		return isVersionGreaterOrEqualThan(version, minVersion ?? MIN_MISE_VERSION);
	}

	async checkNewMiseVersion() {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		if (!shouldCheckForNewMiseVersion()) {
			return;
		}

		const miseVersion = await this.miseVersion();
		if (miseVersion.newVersionAvailable) {
			const ignoreVersion = this.context.globalState.get<string>(
				"mise.ignoreNewVersion",
			);

			if (ignoreVersion === miseVersion.latest) {
				return;
			}

			const canSelfUpdate = await this.canSelfUpdate();

			const suggestion = await vscode.window.showInformationMessage(
				`New Mise version available ${miseVersion.latest}. (Current: ${miseVersion.current})`,
				canSelfUpdate ? "Update Mise" : "How to update Mise",
				"Show changelog",
				"Ignore this update",
			);

			if (suggestion === "How to update Mise") {
				await vscode.env.openExternal(
					vscode.Uri.parse("https://mise.jdx.dev/cli/self-update.html"),
				);
			}

			if (suggestion === "Update Mise") {
				await this.runMiseToolActionInConsole(["self-update", "-y"]);
			}

			if (suggestion === "Show changelog") {
				await vscode.env.openExternal(
					vscode.Uri.parse(
						"https://github.com/jdx/mise/blob/HEAD/CHANGELOG.md",
					),
				);
				await this.checkNewMiseVersion();
			}

			if (suggestion === "Ignore this update") {
				this.context.globalState.update(
					"mise.ignoreNewVersion",
					miseVersion.latest,
				);
			}
		}
	}

	async miseToolInfo(toolName: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}
		const { stdout } = await this.longTTLCache.execCmd({
			args: ["tool", toolName, "--json"],
		});
		return JSON.parse(stdout) as MiseToolInfo;
	}

	async miseRegistry() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.longTTLCache.execCmd({
			args: ["registry"],
			setMiseEnv: false,
		});

		return (
			stdout
				.trim()
				.split("\n")
				.map((line) => {
					const [short = "", ...backends] = line.trim().split(/\s+/);
					return { short, full: backends[0], backends };
				})
				// backends are always `backend:tool` strings; this also drops a
				// potential header line
				.filter((entry) => entry.short && entry.full?.includes(":"))
				.filter(
					(entry, index, self) =>
						self.findIndex((e) => e.short === entry.short) === index,
				)
		);
	}

	async miseBackends() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.longTTLCache.execCmd({
			args: ["backends"],
			setMiseEnv: false,
		});

		return stdout.trim().split("\n");
	}

	async listRemoteVersions(
		toolName: string,
		{ yes = false } = {},
	): Promise<string[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.longTTLCache.execCmd({
				args: ["ls-remote", toolName, ...(yes ? ["--yes"] : [])],
				setMiseEnv: false,
			});
			if (yes) {
				return this.listRemoteVersions(toolName);
			}
			return stdout.trim().split("\n").reverse();
		} catch (error) {
			if (
				error instanceof Error &&
				error?.message?.includes("community-developed plugin")
			) {
				const selection = await vscode.window.showQuickPick(["Yes", "No"], {
					title: `${toolName} is a community-developed plugin. Do you trust it?`,
					placeHolder: "Yes",
				});
				if (selection === "Yes") {
					return this.listRemoteVersions(toolName, { yes: true });
				}
			}
			logger.info("Error fetching remote versions:", error as Error);
			throw error;
		}
	}

	async hasMissingTools() {
		if (!this.getMiseBinaryPath()) {
			return false;
		}

		const tools = await this.getCurrentTools();
		return tools.some((tool) => !tool.installed);
	}

	async miseSetEnv({
		filePath,
		name,
		value,
	}: {
		filePath: string;
		name: string;
		value: string;
	}) {
		await this.execMiseCommand(
			["set", "--file", filePath, `${name}=${value}`],
			{ setMiseEnv: false },
		);
	}
	async getSetting(key: string): Promise<string | undefined> {
		if (!this.getMiseBinaryPath()) {
			return undefined;
		}

		const { stdout } = await this.cache.execCmd({
			args: ["settings", "get", "--quiet", "--silent", key],
			setMiseEnv: undefined,
		});
		return stdout;
	}

	async getSettings() {
		if (!this.getMiseBinaryPath()) {
			return {};
		}

		const { stdout } = await this.execMiseCommand([
			"settings",
			"--all",
			"--json-extended",
		]);
		return flattenSettings(JSON.parse(stdout));
	}

	async getSettingsSchema() {
		return this.longTTLCache.fetchSchema();
	}

	private async parseConfigFileTools(
		configPath: string,
	): Promise<{ path: string; tools: Record<string, unknown> } | undefined> {
		try {
			const stats = await vscode.workspace.fs.stat(vscode.Uri.file(configPath));
			if (stats.type !== vscode.FileType.File) {
				return undefined;
			}

			const content = await vscode.workspace.fs.readFile(
				vscode.Uri.file(configPath),
			);
			if (configPath.endsWith(".toml")) {
				const config = parse(content.toString());
				return { path: configPath, tools: config.tools ?? {} };
			}
			if (isToolVersionsFile(configPath)) {
				return {
					path: configPath,
					tools: parseToolVersionsContent(content.toString()),
				};
			}
			const idiomaticFile = [...idiomaticFiles].find((ext) =>
				configPath.endsWith(ext),
			);
			if (idiomaticFile) {
				return {
					path: configPath,
					tools: {
						// @ts-expect-error
						[idiomaticFileToTool[idiomaticFile]]: content.toString().trim(),
					},
				};
			}
			return { path: configPath, tools: {} };
		} catch {
			return undefined;
		}
	}

	async getTrackedConfigFiles() {
		const trackedConfigFiles = await vscode.workspace.fs.readDirectory(
			vscode.Uri.file(TRACKED_CONFIG_DIR),
		);

		const parsedTrackedConfigs = await Promise.all(
			trackedConfigFiles.map(async ([n]) => {
				const trackedConfigPath = await readlink(
					path.join(TRACKED_CONFIG_DIR, n),
				).catch(() => "");
				if (!trackedConfigPath) {
					return undefined;
				}
				return this.parseConfigFileTools(trackedConfigPath);
			}),
		);

		const validConfigs = parsedTrackedConfigs.filter(
			(trackedConfig) => trackedConfig !== undefined,
		);

		return uniqBy(validConfigs, (c) => c.path).sort((a, b) =>
			a.path.localeCompare(b.path),
		);
	}

	async getProjects(): Promise<MiseProjectsData> {
		return this.projectsCache.getProjects();
	}

	getProjectScanDirectories(): string[] {
		return this.context.globalState.get<string[]>(
			PROJECT_SCAN_DIRECTORIES_KEY,
			[],
		);
	}

	async addProjectScanDirectory(dir: string) {
		const dirs = this.getProjectScanDirectories();
		if (!dirs.includes(dir)) {
			await this.context.globalState.update(PROJECT_SCAN_DIRECTORIES_KEY, [
				...dirs,
				dir,
			]);
		}
		await this.projectsCache.clear();
	}

	async removeProjectScanDirectory(dir: string) {
		await this.context.globalState.update(
			PROJECT_SCAN_DIRECTORIES_KEY,
			this.getProjectScanDirectories().filter((d) => d !== dir),
		);
		await this.projectsCache.clear();
	}

	/**
	 * Tool requests grouped by config file across the whole machine, from
	 * `mise ls --all-sources` (2026+). Empty on older mise versions; the
	 * caller falls back to the parsed tracked configs.
	 */
	private async getConfigsFromAllSources() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}
		try {
			const { stdout } = await this.longTTLCache.execCmd({
				args: ["ls", "--all-sources", "--json"],
				setMiseEnv: false,
			});
			return configsFromLsAllSources(
				JSON.parse(stdout) as MiseLsAllSourcesOutput,
			);
		} catch (error) {
			logger.info("mise ls --all-sources is not available", error);
			return [];
		}
	}

	private async loadProjectEntries(): Promise<MiseProjectsData> {
		const [trackedConfigs, allSourcesConfigs] = await Promise.all([
			// still needed even when `mise ls --all-sources` works: it only
			// reports tools, so task-only configs would be missed
			this.getTrackedConfigFiles().catch(
				() => [] as Array<{ path: string; tools: Record<string, unknown> }>,
			),
			this.getConfigsFromAllSources(),
		]);

		const scanDirs = this.getProjectScanDirectories().map((dir) =>
			expandPath(dir),
		);
		const scannedPaths = (
			await Promise.all(
				scanDirs.map((dir) => findMiseConfigsInDir(dir).catch(() => [])),
			)
		).flat();

		const configsByPath = new Map(
			trackedConfigs.map((config) => [config.path, config]),
		);
		// mise's own resolution wins over our parsed values, tool by tool
		for (const config of allSourcesConfigs) {
			configsByPath.set(config.path, {
				path: config.path,
				tools: { ...configsByPath.get(config.path)?.tools, ...config.tools },
			});
		}

		const scannedConfigs = await Promise.all(
			scannedPaths
				.filter((configPath) => !configsByPath.has(configPath))
				.map((configPath) => this.parseConfigFileTools(configPath)),
		);
		for (const config of scannedConfigs) {
			if (config && !configsByPath.has(config.path)) {
				configsByPath.set(config.path, config);
			}
		}

		const globalConfigFile = process.env.MISE_GLOBAL_CONFIG_FILE;
		return {
			...buildProjectsData([...configsByPath.values()], {
				globalConfigPaths: globalConfigFile ? [globalConfigFile] : [],
			}),
			scanDirectories: this.getProjectScanDirectories(),
		};
	}

	dispose() {
		for (const terminal of this.terminals.values()) {
			if (terminal) {
				terminal.dispose?.();
			}
		}
	}

	async pruneToolsInConsole() {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		const selection = await vscode.window.showWarningMessage(
			"Are you sure you want to prune unused tools?",
			{ modal: true },
			"Yes",
			"dry run",
		);

		if (!selection) {
			return;
		}

		return selection === "Yes"
			? this.runMiseToolActionInConsole(["prune"])
			: this.runMiseToolActionInConsole(["prune", "--dry-run"]);
	}

	async upgradeToolInConsole(toolName: string, { bump = false } = {}) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole(
			bump ? ["up", "--bump", toolName] : ["up", toolName],
		);
	}

	async installToolInConsole(toolName: string, version: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole([
			"install",
			`${toolName}@${version}`,
		]);
	}

	async editSetting(
		setting: string,
		{ value, filePath }: { value: string; filePath: string },
	) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole([
			"config",
			"set",
			`settings.${setting}`,
			value,
			"--file",
			filePath,
		]);
	}

	async createMiseToolSymlink(
		binName: string,
		binPath: string,
		targetType: "dir" | "file" = "dir",
	) {
		const symLinksFolder = getConfiguredSymLinksFolder();
		const toolsPaths = path.isAbsolute(symLinksFolder)
			? symLinksFolder
			: path.join(this.getCurrentWorkspaceFolderPath() ?? "", symLinksFolder);

		const sanitizedBinName = binName.replace(/[^a-zA-Z0-9.-]/g, "_");

		await mkdirp(toolsPaths);
		const linkPath = path.join(toolsPaths, sanitizedBinName);
		const configuredPath = path.isAbsolute(symLinksFolder)
			? linkPath
			: path.join(
					// biome-ignore lint/suspicious/noTemplateCurlyInString: expected
					"${workspaceFolder}",
					symLinksFolder,
					sanitizedBinName,
				);

		if (existsSync(linkPath)) {
			logger.debug(
				`Checking symlink for ${binName}: ${await readlink(linkPath)}: ${binPath}`,
			);
			if ((await readlink(linkPath)) === binPath) {
				return configuredPath;
			}

			logger.info(
				`${linkPath} was symlinked to a different version. Deleting the old symlink now.`,
			);
			await rm(linkPath);
		}

		await symlink(binPath, linkPath, targetType).catch((err) => {
			if (err.code === "EEXIST") {
				logger.info(`Symlink already exists for ${binPath}`);
				return;
			}

			throw err;
		});
		logger.info(`New symlink created ${linkPath} -> ${binPath}`);
		return configuredPath;
	}

	/**
	 * Project graph inferred from ecosystem manifests. Empty outside of a
	 * workspace or when mise does not support `tasks graph` yet.
	 */
	async getTasksGraph(): Promise<MiseProject[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
				args: ["tasks", "graph", "--json"],
			});
			return (JSON.parse(stdout).projects ?? []) as MiseProject[];
		} catch (error) {
			logger.debug("mise tasks graph is not available:", error as Error);
			return [];
		}
	}

	async isBootstrapAvailable() {
		return this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_BOOTSTRAP);
	}

	/**
	 * Aggregate status of `[bootstrap.*]`, `[dotfiles]` and `[tools]` sections.
	 * `undefined` when the installed mise version does not support bootstrap.
	 */
	async getBootstrapStatus(): Promise<MiseBootstrapStatus | undefined> {
		if (!this.getMiseBinaryPath()) {
			return undefined;
		}

		if (!(await this.isBootstrapAvailable())) {
			return undefined;
		}

		try {
			const { stdout } = await this.cache.execCmd({
				args: ["bootstrap", "status", "--json"],
			});
			return JSON.parse(stdout) as MiseBootstrapStatus;
		} catch (error) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				await this.handleUntrustedFile(error);
				return this.getBootstrapStatus();
			}

			throw error;
		}
	}

	async runBootstrapInConsole({ dryRun = false } = {}) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole(
			dryRun ? ["bootstrap", "--dry-run"] : ["bootstrap", "--yes"],
		);
	}
}
