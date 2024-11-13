import * as vscode from "vscode";
import { logger } from "./utils/logger";
import { type MiseConfig, parseMiseConfig } from "./utils/miseDoctorParser";
import { execAsync, execAsyncMergeOutput } from "./utils/shell";
import { type MiseTaskInfo, parseTaskInfo } from "./utils/taskInfoParser";

function ensureMiseCommand(
	miseCommand: string | undefined,
): asserts miseCommand {
	if (!miseCommand) {
		throw new Error("Mise binary path is not configured");
	}
}

export class MiseService {
	private terminal: vscode.Terminal | undefined;
	private readonly workspaceRoot: string | undefined;

	constructor() {
		this.workspaceRoot = vscode.workspace.rootPath;
	}

	async execMiseCommand(command: string, { setProfile = true } = {}) {
		const miseCommand = this.createMiseCommand(command, { setProfile });
		ensureMiseCommand(miseCommand);
		logger.info(`> ${miseCommand}`);
		return execAsync(miseCommand, { cwd: this.workspaceRoot });
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
			const { stdout } = await this.execMiseCommand("tasks ls --json");
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

	async getTools(): Promise<Array<MiseTool>> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.execMiseCommand(
				"ls --current --offline --json",
			);
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
				return this.getTools();
			}

			logger.error("Error fetching mise tools:", error as Error);
			return [];
		}
	}

	async getEnvs(): Promise<MiseEnv[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.execMiseCommand("env --json");
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
				cwd: this.workspaceRoot,
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

	dispose() {
		if (this.terminal) {
			this.terminal.dispose();
			this.terminal = undefined;
		}
	}

	async miseWhich(name: string) {
		const { stdout } = await this.execMiseCommand(`which ${name}`);
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

		const config = parseMiseConfig(stdout);
		logger.info(`Config: ${JSON.stringify(config, null, 2)}`);
		return config;
	}

	async getMiseConfigFiles() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.execMiseCommand("config ls --json");
		return JSON.parse(stdout) as Array<{
			path: string;
			tools: string[];
		}>;
	}

	async miseReshim() {
		await this.execMiseCommand("reshim", { setProfile: false });
	}
}
