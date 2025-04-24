import { existsSync } from "node:fs";
import { readlink, rm, symlink } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { createCache } from "async-cache-dedupe";
import { parse } from "toml-v1";
import * as vscode from "vscode";
import { MISE_RELOAD } from "./commands";
import {
	getCommandTTLCacheSeconds,
	getConfiguredBinPath,
	getCurrentWorkspaceFolderPath,
	getMiseEnv,
	isMiseExtensionEnabled,
	shouldCheckForNewMiseVersion,
	updateBinPath,
} from "./configuration";
import { expandPath, isWindows, mkdirp } from "./utils/fileUtils";
import { uniqBy } from "./utils/fn";
import { logger } from "./utils/logger";
import { resolveMisePath } from "./utils/miseBinLocator";
import { type MiseConfig, parseMiseConfig } from "./utils/miseDoctorParser";
import {
	flattenJsonSchema,
	idiomaticFileToTool,
	idiomaticFiles,
} from "./utils/miseUtilts";
import { showSettingsNotification } from "./utils/notify";
import {
	execAsync,
	execAsyncMergeOutput,
	isTerminalClosed,
	runInVscodeTerminal,
} from "./utils/shell";
import { type MiseTaskInfo, parseTaskInfo } from "./utils/taskInfoParser";

// https://github.com/jdx/mise/blob/main/src/env.rs
const XDG_STATE_HOME =
	process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
const STATE_DIR =
	process.env.MISE_STATE_DIR ?? path.join(XDG_STATE_HOME, "mise");
const TRACKED_CONFIG_DIR = path.join(STATE_DIR, "tracked-configs");

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

function compareVersions(
	a: readonly [number, number, number],
	b: readonly [number, number, number],
) {
	for (let i = 0; i < a.length; i++) {
		// @ts-ignore
		if (a[i] > b[i]) {
			return 1;
		}
		// @ts-ignore
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
	}).define("execCmd", ({ command, setMiseEnv } = {}) =>
		this.execMiseCommand(command, { setMiseEnv }),
	);

	private cache = createCache({
		ttl: getCommandTTLCacheSeconds(),
		storage: { type: "memory" },
	}).define("execCmd", ({ command, setMiseEnv } = {}) =>
		this.execMiseCommand(command, { setMiseEnv }),
	);

	private slowCache = createCache({
		ttl: 60,
		storage: { type: "memory" },
	}).define("execCmd", ({ command, setMiseEnv } = {}) =>
		this.execMiseCommand(command, { setMiseEnv }),
	);

	private longTTLCache = createCache({
		ttl: 60,
		storage: { type: "memory" },
	})
		.define("execCmd", ({ command, setMiseEnv } = {}) =>
			this.execMiseCommand(command, { setMiseEnv }),
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

	async invalidateCache() {
		await Promise.all([
			this.dedupeCache.clear(),
			this.slowCache.clear(),
			this.cache.clear(),
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
			miseBinaryPath = await resolveMisePath();
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
					await this.runMiseToolActionInConsole("self-update -y");
				}
				if (selection === "open mise website") {
					await vscode.env.openExternal(
						vscode.Uri.parse("https://mise.jdx.dev/cli/self-update.html"),
					);
				}
			}
		}
	}

	async execMiseCommand(command: string, { setMiseEnv = true } = {}) {
		const miseCommand = this.createMiseCommand(command, { setMiseEnv });
		ensureMiseCommand(miseCommand);
		logger.debug(`> ${miseCommand}`);
		return execAsync(miseCommand, {
			cwd: this.getCurrentWorkspaceFolderPath(),
		});
	}

	async runMiseToolActionInConsole(
		command: string,
		taskName?: string,
	): Promise<void> {
		try {
			const miseCommand = this.createMiseCommand(command);
			logger.info(`> ${miseCommand}`);

			if (!miseCommand) {
				logger.warn("Could not find mise binary");
				return;
			}

			const execution = new vscode.ShellExecution(miseCommand);
			const task = new vscode.Task(
				{ type: "mise" },
				vscode.TaskScope.Workspace,
				taskName ?? `mise ${command}`,
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

	public createMiseCommand(
		command: string,
		{ setMiseEnv = true } = {},
	): string | undefined {
		const miseBinaryPath = this.getMiseBinaryPath();
		if (!miseBinaryPath) {
			return undefined;
		}

		let miseCommand = miseBinaryPath.includes(" ")
			? isWindows
				? `& "${miseBinaryPath}"`
				: `"${miseBinaryPath}"`
			: miseBinaryPath;

		const miseEnv = getMiseEnv();
		if (miseEnv && setMiseEnv && !command.includes("use --path")) {
			miseCommand = `${miseCommand} --env "${getMiseEnv()}"`;
		}
		return `${miseCommand} ${command}`;
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
			await this.cache.execCmd({ command: "trust" });
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
		await this.cache.execCmd({ command: "trust", setMiseEnv: false });
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
				command: includeHidden ? "tasks ls --json --hidden" : "tasks ls --json",
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
			command: "tasks ls --json --hidden",
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
			const { stdout } = await this.execMiseCommand(`tasks info "${taskName}"`);
			return parseTaskInfo(stdout);
		} catch (error: unknown) {
			logger.info("Error fetching mise task info:", error as Error);
			return undefined;
		}
	}

	async getCurrentTools(
		{
			useCache,
		}: {
			useCache?: boolean;
		} = { useCache: true },
	): Promise<Array<MiseTool>> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const cacheInstance = useCache ? this.cache : this.dedupeCache;
			const { stdout } = await cacheInstance.execCmd({
				command: "ls --current --offline --json",
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
				command: "ls --offline --json",
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

		const { stdout } = await this.cache.execCmd({
			command: bump ? "outdated --bump --json" : "outdated --json",
		});

		if (!stdout) {
			return [];
		}

		return Object.entries(JSON.parse(stdout)).map(([toolName, tool]) => {
			const foundTool = tool as {
				name: string;
				requested: string;
				current: string;
				latest: string;
				bump: string;
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

	async useRmTool(filename: string, toolName: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		const cmd = ["use"];
		if (filename) {
			const normalizedPath = isWindows
				? filename.replace(/\\/g, "/").replace(/^\//, "")
				: filename;

			cmd.push(`--path "${normalizedPath}"`);
		}
		cmd.push("--rm");
		cmd.push(toolName);
		await this.runMiseToolActionInConsole(cmd.join(" "));
	}

	async removeToolInConsole(toolName: string, version?: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole(
			version ? `uninstall ${toolName}@${version}` : `uninstall ${toolName}`,
		);
	}

	async getEnvs(): Promise<MiseEnv[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
				command: "env --json",
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

	async getEnvWithInfo() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.cache.execCmd({
			command: "env --json-extended",
		});

		const parsed = JSON.parse(stdout) as Record<string, MiseEnvWithInfo>;
		return Object.entries(parsed).map(([key, info]) => ({
			name: key,
			value: info.value ?? "",
			tool: info?.tool,
			source: info?.source ? expandPath(info.source) : undefined,
		}));
	}

	async miseFmt() {
		await this.execMiseCommand("fmt", { setMiseEnv: false });
	}

	async runTask(taskName: string, ...args: string[]): Promise<void> {
		const terminal = this.getOrCreateTerminal("Mise run");
		terminal.show();

		const runTaskCmd = isWindows
			? `run "${taskName.replace(/"/g, '\\"')}"`
			: `run '${taskName.replace(/'/g, "\\'")}'`;
		const baseCommand = this.createMiseCommand(runTaskCmd);
		ensureMiseCommand(baseCommand);
		await runInVscodeTerminal(terminal, `${baseCommand} ${args.join(" ")}`);
	}

	async watchTask(taskName: string, ...args: string[]): Promise<void> {
		const terminalName = `mise-watch ${taskName}`;
		const previousTerminal = this.terminals.get(terminalName);
		if (previousTerminal) {
			previousTerminal.dispose();
			this.terminals.delete(terminalName);
		}
		const terminal = this.getOrCreateTerminal(terminalName);
		terminal.show();
		const watchTaskCmd = isWindows
			? `watch "${taskName.replace(/"/g, '\\"')}"`
			: `watch '${taskName.replace(/'/g, "\\'")}'`;
		const baseCommand = this.createMiseCommand(watchTaskCmd);
		ensureMiseCommand(baseCommand);
		await runInVscodeTerminal(terminal, `${baseCommand} ${args.join(" ")}`);
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
			command: `bin-paths ${name}`,
		});
		return stdout.trim().split("\n");
	}

	async which(name: string): Promise<string | undefined> {
		try {
			const { stdout } = await this.cache.execCmd({ command: `which ${name}` });

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

	async getMiseConfiguration(): Promise<MiseConfig> {
		const miseCmd = this.createMiseCommand("doctor", {
			setMiseEnv: false,
		});

		const { stdout, stderr } = await execAsyncMergeOutput(miseCmd ?? "");
		if (stderr) {
			logger.debug(miseCmd, stderr);
		}

		return parseMiseConfig(stdout);
	}

	async miseDoctor() {
		const { stdout, stderr } = await execAsyncMergeOutput(
			this.createMiseCommand("doctor", { setMiseEnv: false }) ?? "",
		);
		return `${stdout}\n${stderr}`;
	}

	async getMiseConfigFiles() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.cache.execCmd({
			command: "config ls --json",
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
		await this.execMiseCommand("reshim", { setMiseEnv: false }).catch(
			(error) => {
				logger.info("mise reshim", error as Error);
			},
		);
	}

	async getVersion() {
		const miseCommand = this.createMiseCommand("version", {
			setMiseEnv: false,
		});
		if (!miseCommand) {
			return "";
		}

		const { stdout, stderr } = await execAsyncMergeOutput(miseCommand ?? "");
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

	async canSelfUpdate() {
		if (!this.getMiseBinaryPath()) {
			return false;
		}

		try {
			await this.execMiseCommand("self-update --help");
			return true;
		} catch (e) {
			return false;
		}
	}

	async hasValidMiseVersion() {
		if (!this.getMiseBinaryPath()) {
			return false;
		}

		const version = await this.getParsedMiseVersion();
		if (!version) {
			return false;
		}

		return isVersionGreaterOrEqualThan(version, MIN_MISE_VERSION);
	}

	async checkNewMiseVersion() {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		if (!shouldCheckForNewMiseVersion()) {
			return;
		}

		const miseConfig = await this.getMiseConfiguration();
		const newMiseVersionAvailable =
			miseConfig.problems?.newMiseVersionAvailable;
		if (newMiseVersionAvailable) {
			const ignoreVersion = this.context.globalState.get<string>(
				"mise.ignoreNewVersion",
			);

			if (ignoreVersion === newMiseVersionAvailable.latestVersion) {
				return;
			}

			const canSelfUpdate = await this.canSelfUpdate();
			const suggestion = await vscode.window.showInformationMessage(
				`New Mise version available ${newMiseVersionAvailable?.latestVersion}. (Current: ${newMiseVersionAvailable?.currentVersion})`,
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
				await this.runMiseToolActionInConsole("self-update -y");
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
					newMiseVersionAvailable.latestVersion,
				);
			}
		}
	}

	async miseToolInfo(toolName: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}
		const { stdout } = await this.cache.execCmd({
			command: `tool "${toolName.replace(/"/g, '\\"')}" --json`,
		});
		return JSON.parse(stdout) as MiseToolInfo;
	}

	async miseRegistry() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.longTTLCache.execCmd({
			command: "registry",
			setMiseEnv: false,
		});

		return stdout
			.trim()
			.split("\n")
			.slice(1)
			.map((line) => {
				const [short, full] = line.split(/\s+/);
				return { short, full };
			})
			.filter((entry) => entry.short && entry.full)
			.filter(
				(entry, index, self) =>
					self.findIndex((e) => e.short === entry.short) === index,
			);
	}

	async miseBackends() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.longTTLCache.execCmd({
			command: "backends",
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
				command: `ls-remote ${toolName}${yes ? " --yes" : ""}`,
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
	}: { filePath: string; name: string; value: string }) {
		await this.execMiseCommand(
			`set --file "${filePath}" "${name.replace(/"/g, '\\"')}"="${value.replace(
				/"/g,
				'\\"',
			)}"`,
			{ setMiseEnv: false },
		);
	}
	async getSetting(key: string): Promise<string | undefined> {
		if (!this.getMiseBinaryPath()) {
			return undefined;
		}

		const { stdout } = await this.cache.execCmd({
			command: `settings get --quiet --silent ${key}`,
			setMiseEnv: undefined,
		});
		return stdout;
	}

	async getSettings() {
		if (!this.getMiseBinaryPath()) {
			return {};
		}

		const { stdout } = await this.execMiseCommand(
			"settings --all --json-extended",
		);
		return flattenSettings(JSON.parse(stdout));
	}

	async getSettingsSchema() {
		return this.longTTLCache.fetchSchema();
	}

	async getTrackedConfigFiles() {
		const trackedConfigFiles = await vscode.workspace.fs.readDirectory(
			vscode.Uri.file(TRACKED_CONFIG_DIR),
		);

		const parsedTrackedConfigs = await Promise.all(
			trackedConfigFiles.map(async ([n]) => {
				try {
					const trackedConfigPath = await readlink(
						path.join(TRACKED_CONFIG_DIR, n),
					).catch(() => "");
					if (!trackedConfigPath) {
						return {};
					}

					const stats = await vscode.workspace.fs.stat(
						vscode.Uri.file(trackedConfigPath),
					);

					if (stats.type === vscode.FileType.File) {
						const content = await vscode.workspace.fs.readFile(
							vscode.Uri.file(trackedConfigPath),
						);
						if (trackedConfigPath.endsWith(".toml")) {
							const config = parse(content.toString());
							return {
								path: trackedConfigPath,
								tools: config.tools ?? {},
							};
						}
						const idiomaticFile = [...idiomaticFiles].find((ext) =>
							trackedConfigPath.endsWith(ext),
						);
						if (idiomaticFile) {
							return {
								path: trackedConfigPath,
								tools: {
									// @ts-ignore
									[idiomaticFileToTool[idiomaticFile]]: content
										.toString()
										.trim(),
								},
							};
						}
						return { path: trackedConfigPath, tools: {} };
					}
				} catch {
					return {};
				}
			}),
		);

		const validConfigs = parsedTrackedConfigs.filter(
			(trackedConfigPath) => trackedConfigPath?.path,
		) as Array<{ path: string; tools: object }>;

		return uniqBy(validConfigs, (c) => c.path).sort((a, b) =>
			a.path.localeCompare(b.path),
		);
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
			? this.runMiseToolActionInConsole("prune")
			: this.runMiseToolActionInConsole("prune --dry-run");
	}

	async upgradeToolInConsole(toolName: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole(`up ${toolName}`);
	}

	async installToolInConsole(toolName: string, version: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole(`install ${toolName}@${version}`);
	}

	async editSetting(
		setting: string,
		{ value, filePath }: { value: string; filePath: string },
	) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole(
			`config set settings.${setting} "${value}" --file "${filePath}"`,
		);
	}

	async createMiseToolSymlink(
		binName: string,
		binPath: string,
		targetType: "dir" | "file" = "dir",
	) {
		const toolsPaths = path.join(
			this.getCurrentWorkspaceFolderPath() ?? "",
			".vscode",
			"mise-tools",
		);

		const sanitizedBinName = binName.replace(/[^a-zA-Z0-9.]/g, "_");

		await mkdirp(toolsPaths);
		const linkPath = path.join(toolsPaths, sanitizedBinName);
		const configuredPath = path.join(
			"${workspaceFolder}",
			".vscode",
			"mise-tools",
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
				`mise-tools/${binPath} was symlinked to a different version. Deleting the old symlink now.`,
			);
			await rm(linkPath);
		}

		await symlink(binPath, linkPath, targetType).catch((err) => {
			if (err.code === "EEXIST") {
				logger.info("Symlink already exists for ${binPath}");
				return;
			}

			throw err;
		});
		logger.info(`New symlink created ${linkPath} -> ${binPath}`);
		return configuredPath;
	}

	async getTaskDependencies(tasks: string[] | undefined) {
		if (!this.getMiseBinaryPath()) {
			return "";
		}

		const taskString = tasks ? tasks.map((task) => `"${task}"`).join(" ") : "";

		const { stdout } = await this.cache.execCmd({
			command: `tasks deps ${taskString} --dot`,
		});
		return stdout;
	}
}
