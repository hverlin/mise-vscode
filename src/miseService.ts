import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { logger } from "./utils/logger";

const execAsync = promisify(exec);

export class MiseService {
	private terminal: vscode.Terminal | undefined;
	private readonly workspaceRoot: string | undefined;

	constructor() {
		this.workspaceRoot = vscode.workspace.rootPath;
	}

	async getTasks(): Promise<MiseTask[]> {
		try {
			const { stdout } = await execAsync("mise tasks ls --json", {
				cwd: this.workspaceRoot,
			});
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

	async getTools(): Promise<Array<MiseTool>> {
		logger.info("Executing mise ls 4 command");

		try {
			const { stdout } = await execAsync("mise ls --current --offline --json", {
				cwd: this.workspaceRoot,
			});
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
			const { stdout } = await execAsync("mise env --json", {
				cwd: this.workspaceRoot,
			});

			return Object.entries(JSON.parse(stdout)).map(([key, value]) => ({
				name: key,
				value: value as string,
			}));
		} catch (error) {
			logger.error("Error fetching mise environments:", error as Error);
			return [];
		}
	}

	async runTask(taskName: string): Promise<void> {
		const terminal = this.getOrCreateTerminal();
		terminal.show();
		terminal.sendText(`mise run ${taskName}`);
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
