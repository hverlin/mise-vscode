import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { logger } from "./utils/logger";

const execAsync = promisify(exec);

export class MiseService {
	async getTasks(): Promise<MiseTask[]> {
		try {
			const { stdout } = await execAsync("mise tasks ls --json", {
				cwd: vscode.workspace.rootPath,
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
				cwd: vscode.workspace.rootPath,
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
				cwd: vscode.workspace.rootPath,
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
}
