import { readlink } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { createCache } from "async-cache-dedupe";
import { parse } from "toml-v1";
import * as vscode from "vscode";
import { MISE_RELOAD } from "./commands";
import {
	getConfiguredBinPath,
	getMiseEnv,
	getRootFolderPath,
	isMiseExtensionEnabled,
	shouldCheckForNewMiseVersion,
	updateBinPath,
} from "./configuration";
import { expandPath } from "./utils/fileUtils";
import { uniqBy } from "./utils/fn";
import { logger } from "./utils/logger";
import { resolveMisePath } from "./utils/miseBinLocator";
import { type MiseConfig, parseMiseConfig } from "./utils/miseDoctorParser";
import { idiomaticFileToTool, idiomaticFiles } from "./utils/miseUtilts";
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

const MIN_MISE_VERSION = [2024, 11, 32] as const;

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
	private hasVerifiedMiseVersion = false;

	private terminals: Map<string, vscode.Terminal | undefined> = new Map();

	private cache = createCache({
		ttl: 1,
		storage: { type: "memory" },
	}).define("execCmd", ({ command, setMiseEnv } = {}) =>
		this.execMiseCommand(command, { setMiseEnv }),
	);

	invalidateCache() {
		return this.cache.clear();
	}

	async initializeMisePath() {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		let miseBinaryPath = "mise";
		try {
			miseBinaryPath = await resolveMisePath();
			const previousPath = getConfiguredBinPath();
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
			void showSettingsNotification(
				"Mise binary not found. Please configure the binary path.",
				{ settingsKey: "mise.binPath", type: "error" },
			);
			logger.info(
				`Failed to resolve mise binary path: ${error instanceof Error ? error?.message : String(error)}`,
			);
		}

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
		return execAsync(miseCommand, { cwd: getRootFolderPath() });
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

			const p = new Promise((resolve, reject) => {
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
			? process.platform === "win32"
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
		const match = error.message.match(/file (.*?) is not trusted/);
		if (!match) {
			logger.error(
				"Could not extract filename from trust error message:",
				error,
			);
			throw new Error("Invalid trust error message format");
		}

		const filename = match[1];
		const trustAction = "Trust File";
		const selection = await vscode.window.showErrorMessage(
			`The Mise configuration file "${filename}" is not trusted. Would you like to trust it?`,
			{ modal: true },
			trustAction,
		);

		if (selection !== trustAction) {
			throw new Error("User declined to trust file");
		}

		try {
			await this.execMiseCommand("trust");
		} catch (trustError) {
			logger.error("Error trusting mise configuration:", trustError as Error);
			throw new Error(
				`Failed to trust the Mise configuration file "${filename}". Please try again or trust it manually.`,
			);
		}
	}

	async getTasks(): Promise<MiseTask[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
				command: "tasks ls --json",
			});
			return JSON.parse(stdout).map((task: MiseTask) => ({
				name: task.name,
				source: task.source,
				description: task.description,
			}));
		} catch (error: unknown) {
			if (error instanceof Error && error.message.includes("is not trusted")) {
				await this.handleUntrustedFile(error);
				return this.getTasks();
			}

			logger.info("Error fetching mise tasks:", error as Error);
			return [];
		}
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
			const { stdout } = await this.execMiseCommand(`tasks info ${taskName}`);
			return parseTaskInfo(stdout);
		} catch (error: unknown) {
			logger.info("Error fetching mise task info:", error as Error);
			return undefined;
		}
	}

	async getCurrentTools(): Promise<Array<MiseTool>> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
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
			if (error instanceof Error && error.message.includes("is not trusted")) {
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
			if (error instanceof Error && error.message.includes("is not trusted")) {
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
			cmd.push(`--path "${filename}"`);
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
			version ? `rm ${toolName}@${version}` : `rm ${toolName}`,
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
			if (error instanceof Error && error.message.includes("is not trusted")) {
				await this.handleUntrustedFile(error);
				return this.getEnvs();
			}

			logger.info("Error fetching mise environments:", error as Error);
			return [];
		}
	}

	async runTask(taskName: string, ...args: string[]): Promise<void> {
		const terminal = this.getOrCreateTerminal("Mise run");
		terminal.show();
		const baseCommand = this.createMiseCommand(`run ${taskName}`);
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
		const baseCommand = this.createMiseCommand(
			`watch -t "${taskName.replace(/"/g, '\\"')}"`,
		);
		ensureMiseCommand(baseCommand);
		await runInVscodeTerminal(terminal, `${baseCommand} ${args.join(" ")}`);
	}

	private getOrCreateTerminal(name: string): vscode.Terminal {
		let terminal = this.terminals.get(name);
		if (!terminal || isTerminalClosed(terminal)) {
			terminal = vscode.window.createTerminal({
				name,
				cwd: getRootFolderPath(),
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

	async miseWhich(name: string) {
		const { stdout } = await this.cache.execCmd({
			command: `which ${name}`,
		});
		return stdout.trim();
	}

	async getMiseConfiguration(): Promise<MiseConfig> {
		const miseCmd = this.createMiseCommand("doctor", {
			setMiseEnv: false,
		});

		const { stdout, stderr } = await execAsyncMergeOutput(miseCmd ?? "");
		if (stderr) {
			logger.info(miseCmd, stderr);
		}

		return parseMiseConfig(stdout);
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
		configFiles.add(path.join(getRootFolderPath() || "", "mise.toml"));
		configFiles.add(path.join(os.homedir(), ".config", "mise", "config.toml"));

		const miseConfigs = (await this.getMiseConfigFiles())
			.map((file) => expandPath(file.path))
			.filter((path) => path.endsWith(".toml"));

		for (const file of miseConfigs) {
			configFiles.add(file);
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
			logger.info(`Mise stderr: ${stderr.trim()}`);
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
			const canSelfUpdate = await this.canSelfUpdate();
			const suggestion = await vscode.window.showInformationMessage(
				`New Mise version available ${newMiseVersionAvailable?.latestVersion}. (Current: ${newMiseVersionAvailable?.currentVersion})`,
				canSelfUpdate ? "Update Mise" : "How to update Mise",
				"Show changelog",
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
		}
	}

	async miseRegistry() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.execMiseCommand("registry", {
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

	async listRemoteVersions(
		toolName: string,
		{ yes = false } = {},
	): Promise<string[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.execMiseCommand(
				`ls-remote ${toolName}${yes ? " --yes" : ""}`,
				{ setMiseEnv: false },
			);
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
			`set --file "${filePath}" "${name.replace(/"/g, '\\"')}"="${value.replace(/"/g, '\\"')}"`,
			{ setMiseEnv: false },
		);
	}

	async getSettings() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const version = await this.getParsedMiseVersion();
		if (version && isVersionGreaterOrEqualThan(version, [2024, 11, 34])) {
			const { stdout } = await this.execMiseCommand("settings --all --toml");
			return parse(stdout);
		}

		const { stdout } = await this.execMiseCommand("settings");
		return parse(stdout);
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
							return { path: trackedConfigPath, tools: config.tools ?? {} };
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
}
