import * as os from "node:os";
import path from "node:path";
import * as toml from "@iarna/toml";
import { createCache } from "async-cache-dedupe";
import * as vscode from "vscode";
import { getRootFolderPath, isMiseExtensionEnabled } from "./configuration";
import { expandPath } from "./utils/fileUtils";
import { logger } from "./utils/logger";
import { resolveMisePath } from "./utils/miseBinLocator";
import { type MiseConfig, parseMiseConfig } from "./utils/miseDoctorParser";
import { showSettingsNotification } from "./utils/notify";
import { execAsync, execAsyncMergeOutput } from "./utils/shell";
import { type MiseTaskInfo, parseTaskInfo } from "./utils/taskInfoParser";

const MIN_MISE_VERSION = [2024, 11, 4] as const;

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
	private terminal: vscode.Terminal | undefined;
	private cache = createCache({
		ttl: 0,
		storage: { type: "memory" },
	}).define("execCmd", ({ command, setProfile } = {}) =>
		this.execMiseCommand(command, { setProfile }),
	);
	private hasVerifiedMiseVersion = false;

	async initializeMisePath() {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		let miseBinaryPath = "mise";
		try {
			miseBinaryPath = await resolveMisePath();
			const config = vscode.workspace.getConfiguration("mise");
			const previousPath = config.get<string>("binPath");
			if (previousPath !== miseBinaryPath) {
				logger.info(`Mise binary path resolved to: ${miseBinaryPath}`);

				config.update(
					"binPath",
					miseBinaryPath,
					vscode.ConfigurationTarget.Global,
				);
				void showSettingsNotification(
					`Mise binary path has been updated to: ${miseBinaryPath}`,
					{ settingsKey: "mise.binPath", type: "info" },
				);
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
			const hasValidMiseVersion = await this.hasValidMiseVersion();
			if (!hasValidMiseVersion) {
				const selection = await vscode.window.showErrorMessage(
					`Mise version ${version} is not supported. Please update to a supported version.`,
					{ modal: true },
					"Run mise self-update",
				);
				this.hasVerifiedMiseVersion = true;
				if (selection === "Run mise self-update") {
					await this.runMiseToolActionInConsole("self-update");
				}
			}
		}
	}

	async execMiseCommand(command: string, { setProfile = true } = {}) {
		const miseCommand = this.createMiseCommand(command, { setProfile });
		ensureMiseCommand(miseCommand);
		logger.info(`> ${miseCommand}`);
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
						vscode.commands.executeCommand("mise.refreshEntry");
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
		return vscode.workspace.getConfiguration("mise").get("binPath");
	}

	public createMiseCommand(
		command: string,
		{ setProfile = true } = {},
	): string | undefined {
		const miseBinaryPath = this.getMiseBinaryPath();
		if (!miseBinaryPath) {
			return undefined;
		}

		let miseCommand = `"${miseBinaryPath}"`;
		const miseProfile = vscode.workspace
			.getConfiguration("mise")
			.get("profile");

		if (miseProfile && setProfile && !command.includes("use --path")) {
			miseCommand = `${miseCommand} --profile ${miseProfile}`;
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

			logger.error("Error fetching mise tasks:", error as Error);
			return [];
		}
	}

	async getTaskInfo(taskName: string): Promise<MiseTaskInfo | undefined> {
		if (!this.getMiseBinaryPath()) {
			return undefined;
		}

		try {
			const { stdout } = await this.execMiseCommand(`tasks info ${taskName}`);
			return parseTaskInfo(stdout);
		} catch (error: unknown) {
			logger.error("Error fetching mise task info:", error as Error);
			return undefined;
		}
	}

	async getCurrentTools(): Promise<Array<MiseTool>> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
				command: "ls --current --json",
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

			logger.error("Error fetching mise tools:", error as Error);
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

	async removeToolInConsole(toolName: string, version?: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole(
			version ? `rm ${toolName} ${version}` : `rm ${toolName}`,
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

			logger.error("Error fetching mise environments:", error as Error);
			return [];
		}
	}

	async runTask(taskName: string, ...args: string[]): Promise<void> {
		const terminal = this.getOrCreateTerminal();
		terminal.show();
		const baseCommand = this.createMiseCommand(`run --timing ${taskName}`);
		ensureMiseCommand(baseCommand);
		terminal.sendText(`${baseCommand} ${args.join(" ")}`);
	}

	async watchTask(taskName: string, ...args: string[]): Promise<void> {
		const terminal = this.getOrCreateTerminal();
		terminal.show();
		const baseCommand = this.createMiseCommand(
			`watch -t "${taskName.replace(/"/g, '\\"')}"`,
		);
		ensureMiseCommand(baseCommand);
		terminal.sendText(`${baseCommand} ${args.join(" ")}`);
	}

	private getOrCreateTerminal(): vscode.Terminal {
		if (!this.terminal || this._isTerminalClosed(this.terminal)) {
			this.terminal = vscode.window.createTerminal({
				name: "Mise Tasks",
				cwd: getRootFolderPath(),
			});

			vscode.window.onDidCloseTerminal((closedTerminal) => {
				if (closedTerminal === this.terminal) {
					this.terminal = undefined;
				}
			});
		}
		return this.terminal;
	}

	private _isTerminalClosed(terminal: vscode.Terminal): boolean {
		return vscode.window.terminals.indexOf(terminal) === -1;
	}

	async miseWhich(name: string) {
		const { stdout } = await this.cache.execCmd({
			command: `which ${name}`,
		});
		return stdout.trim();
	}

	async getMiseConfiguration(): Promise<MiseConfig> {
		const miseCmd = this.createMiseCommand("doctor", {
			setProfile: false,
		});

		const { stdout, stderr } = await execAsyncMergeOutput(miseCmd ?? "");
		if (stderr) {
			logger.warn(stderr);
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
		await this.execMiseCommand("reshim", { setProfile: false });
	}

	async getVersion() {
		if (!this.getMiseBinaryPath()) {
			return "mise binary path is not configured";
		}

		const { stdout } = await this.execMiseCommand("--version", {
			setProfile: false,
		});
		return stdout.trim();
	}

	async hasValidMiseVersion() {
		if (!this.getMiseBinaryPath()) {
			return false;
		}

		const version = await this.getVersion();
		const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
		if (!match) {
			return false;
		}

		const [, year, month, day] = match.map((n) =>
			n ? Number.parseInt(n, 10) : undefined,
		);
		if (year === undefined || month === undefined || day === undefined) {
			return false;
		}

		if (year > MIN_MISE_VERSION[0]) {
			return true;
		}
		if (year < MIN_MISE_VERSION[0]) {
			return false;
		}

		if (month > MIN_MISE_VERSION[1]) {
			return true;
		}
		if (month < MIN_MISE_VERSION[1]) {
			return false;
		}

		return day >= MIN_MISE_VERSION[2];
	}

	async checkNewMiseVersion() {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		const miseConfig = await this.getMiseConfiguration();
		const newMiseVersionAvailable =
			miseConfig.problems?.newMiseVersionAvailable;
		if (newMiseVersionAvailable) {
			const suggestion = await vscode.window.showInformationMessage(
				`New Mise version available ${newMiseVersionAvailable?.latestVersion}. (Current: ${newMiseVersionAvailable?.currentVersion})`,
				"Update Mise",
				"Show changelog",
			);

			if (suggestion === "Update Mise") {
				await this.runMiseToolActionInConsole("self-update");
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
			setProfile: false,
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
				{ setProfile: false },
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
			logger.error("Error fetching remote versions:", error as Error);
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
			{ setProfile: false },
		);
	}

	async getSettings() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.execMiseCommand("settings");
		return toml.parse(stdout);
	}

	dispose() {
		if (this.terminal) {
			this.terminal.dispose();
			this.terminal = undefined;
		}
	}
}
