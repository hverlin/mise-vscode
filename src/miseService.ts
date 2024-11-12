import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { logger } from "./utils/logger";
import { type MiseTaskInfo, parseTaskInfo } from "./utils/taskInfoParser";

const execAsync = promisify(exec);

export class MiseService {
	private terminal: vscode.Terminal | undefined;
	private readonly workspaceRoot: string | undefined;

	constructor() {
		this.workspaceRoot = vscode.workspace.rootPath;
	}

	async execMiseCommand(command: string) {
		const miseCommand = `mise ${command}`;
		logger.info(`Executing mise command: ${miseCommand}`);
		return execAsync(miseCommand, { cwd: this.workspaceRoot });
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
			logger.info(`Got stdout from mise ls 4 command ${stdout}`);
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
		terminal.sendText(`mise run ${taskName} ${args.join(" ")}`);
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
