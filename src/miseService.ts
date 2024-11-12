import * as vscode from "vscode";
import { logger } from "./utils/logger";
import { execAsync } from "./utils/shell";
import { type MiseTaskInfo, parseTaskInfo } from "./utils/taskInfoParser";

export class MiseService {
	private terminal: vscode.Terminal | undefined;
	private readonly workspaceRoot: string | undefined;

	constructor() {
		this.workspaceRoot = vscode.workspace.rootPath;
	}

	async execMiseCommand(command: string) {
		const miseCommand = this.createMiseCommand(command);
		logger.info(`Executing mise command: ${miseCommand}`);
		return execAsync(miseCommand, { cwd: this.workspaceRoot });
	}

	public createMiseCommand(command: string) {
		const miseBinaryPath = vscode.workspace
			.getConfiguration("mise")
			.get("binPath");

		let miseCommand = `"${miseBinaryPath}"`;
		const miseProfile = vscode.workspace
			.getConfiguration("mise")
			.get("profile");

		if (miseProfile) {
			miseCommand = `${miseCommand} --profile ${miseProfile}`;
		}
		return `${miseCommand} ${command}`;
	}

	async getTasks(): Promise<MiseTask[]> {
		try {
			const { stdout } = await this.execMiseCommand("tasks ls --json");
			return JSON.parse(stdout).map((task: MiseTask) => ({
				name: task.name,
				source: task.source,
				description: task.description,
			}));
		} catch (error: unknown) {
			logger.error("Error fetching mise tasks:", error as Error);
			return [];
		}
	}

	async getTaskInfo(taskName: string): Promise<MiseTaskInfo | undefined> {
		try {
			const { stdout } = await this.execMiseCommand(`tasks info ${taskName}`);
			return parseTaskInfo(stdout);
		} catch (error: unknown) {
			logger.error("Error fetching mise task info:", error as Error);
			return undefined;
		}
	}

	async getTools(): Promise<Array<MiseTool>> {
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
			logger.error("Error fetching mise tools:", error as Error);
			return [];
		}
	}

	async getEnvs(): Promise<MiseEnv[]> {
		try {
			const { stdout } = await this.execMiseCommand("env --json");
			return Object.entries(JSON.parse(stdout)).map(([key, value]) => ({
				name: key,
				value: value as string,
			}));
		} catch (error) {
			logger.error("Error fetching mise environments:", error as Error);
			return [];
		}
	}

	async runTask(taskName: string, ...args: string[]): Promise<void> {
		const terminal = this.getOrCreateTerminal();
		terminal.show();
		const baseCommand = this.createMiseCommand(`run --timing ${taskName}`);
		terminal.sendText(`${baseCommand} ${args.join(" ")}`);
	}

	async watchTask(taskName: string, ...args: string[]): Promise<void> {
		const terminal = this.getOrCreateTerminal();
		terminal.show();
		const baseCommand = this.createMiseCommand(
			`watch -t "${taskName.replace(/"/g, '\\"')}"`,
		);
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
}
