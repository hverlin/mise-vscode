import * as vscode from "vscode";
import {
	MISE_COPY_ENV_VARIABLE_NAME,
	MISE_COPY_ENV_VARIABLE_VALUE,
	MISE_OPEN_ENV_VAR_DEFINITION,
	MISE_OPEN_TOOL_DEFINITION,
	MISE_SET_ENV_VARIABLE,
} from "../commands";
import {
	isMiseExtensionEnabled,
	shouldAutomaticallyReloadTerminalEnv,
	shouldUpdateEnv,
} from "../configuration";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import { findEnvVarPosition } from "../utils/miseFileParser";
import { runInVscodeTerminal } from "../utils/shell";

export class MiseEnvsProvider implements vscode.TreeDataProvider<EnvItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<
		void | EnvItem | null | undefined
	> = new vscode.EventEmitter<EnvItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<
		EnvItem | undefined | null | void
	> = this._onDidChangeTreeData.event;

	constructor(private miseService: MiseService) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: EnvItem): vscode.TreeItem {
		return element;
	}

	async getEnvItems() {
		const envs = await this.miseService.getEnvWithInfo();
		return envs.map((env) => new EnvItem(env));
	}

	async getChildren(): Promise<EnvItem[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		try {
			return await this.getEnvItems();
		} catch (e) {
			logger.info("Error while fetching mise envs", e);
			vscode.commands.executeCommand(
				"setContext",
				"mise.envProviderError",
				true,
			);
			return [];
		}
	}
}

class EnvItem extends vscode.TreeItem {
	constructor(public env: MiseEnvWithInfo) {
		const label = env.value ? `${env.name}=${env.value}` : env.name;
		super(label, vscode.TreeItemCollapsibleState.None);
		this.tooltip = [
			`${env.name}=${env.value}`,
			env.source ? `source: ${env.source}` : "",
			env.tool ? `Tool: ${env.tool}` : "",
		]
			.filter(Boolean)
			.join("\n");

		this.contextValue = "envItem";
		this.command = {
			command: MISE_OPEN_ENV_VAR_DEFINITION,
			arguments: [this.env.name],
			title: "Copy name",
		};
	}
}

export function registerEnvsCommands(
	context: vscode.ExtensionContext,
	miseService: MiseService,
) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			MISE_OPEN_ENV_VAR_DEFINITION,
			async (name: string | undefined) => {
				const possibleEnvs = await miseService.getEnvWithInfo();
				let selectedName = name;
				if (!selectedName) {
					selectedName = await vscode.window.showQuickPick(
						possibleEnvs.map((env) => env.name),
					);
				}

				const env = possibleEnvs.find((env) => env.name === selectedName);

				if (!env) {
					return;
				}

				if (env.source) {
					const document = await vscode.workspace.openTextDocument(env.source);
					const needle = findEnvVarPosition([document], env.name);
					if (needle?.range) {
						void vscode.window.showTextDocument(needle.document, {
							selection: needle.range,
						});
					}
				} else if (env.tool) {
					await vscode.commands.executeCommand(
						MISE_OPEN_TOOL_DEFINITION,
						env.tool,
					);
				} else {
					const configs = (await miseService.getMiseConfigFiles()).filter((c) =>
						c.path.endsWith(".toml"),
					);

					const documents = await Promise.all(
						configs.map((config) =>
							vscode.workspace.openTextDocument(config.path),
						),
					);
					const needle = findEnvVarPosition(documents, env.name);

					if (needle?.range) {
						void vscode.window.showTextDocument(needle.document, {
							selection: needle.range,
						});
					}
				}
			},
		),
		vscode.commands.registerCommand(
			MISE_COPY_ENV_VARIABLE_NAME,
			async (name: EnvItem | string | undefined) => {
				let selectedName = name;
				if (!selectedName) {
					const possibleEnvs = await miseService.getEnvs();
					selectedName = await vscode.window.showQuickPick(
						possibleEnvs.map((env) => env.name),
					);
				} else if (selectedName instanceof EnvItem) {
					selectedName = selectedName.env.name;
				}

				if (!selectedName) {
					return;
				}

				await vscode.env.clipboard.writeText(selectedName);
				vscode.window.showInformationMessage(`Copied name of ${selectedName}`);
			},
		),
		vscode.commands.registerCommand(
			MISE_COPY_ENV_VARIABLE_VALUE,
			async (name: EnvItem | string | undefined) => {
				const possibleEnvs = await miseService.getEnvs();
				let selectedName = name;
				if (!selectedName) {
					selectedName = await vscode.window.showQuickPick(
						possibleEnvs.map((env) => env.name),
					);
				} else if (selectedName instanceof EnvItem) {
					selectedName = selectedName.env.name;
				}

				const env = possibleEnvs.find((env) => env.name === selectedName);

				if (!env) {
					return;
				}
				await vscode.env.clipboard.writeText(env.value);
				vscode.window.showInformationMessage(`Copied value of ${env.name}`);
			},
		),
		vscode.commands.registerCommand(
			MISE_SET_ENV_VARIABLE,
			async (filePath: string | undefined) => {
				let selectedPath = filePath?.trim?.();
				if (!selectedPath) {
					selectedPath = await vscode.window.showQuickPick(
						await miseService.getMiseTomlConfigFilePathsEvenIfMissing(),
						{ placeHolder: "Select a configuration file" },
					);
				}

				if (!selectedPath) {
					return;
				}

				logger.info(`Selected path: ${selectedPath}`);
				const environmentVariableName = await vscode.window.showInputBox({
					placeHolder: "Environment variable name",
				});
				if (!environmentVariableName) {
					return;
				}

				const environmentVariableValue = await vscode.window.showInputBox({
					placeHolder: "Environment variable value",
				});

				if (!environmentVariableValue) {
					return;
				}

				await miseService.miseSetEnv({
					filePath: selectedPath,
					name: environmentVariableName,
					value: environmentVariableValue,
				});
			},
		),
	);
}

let previousEnvs: Map<string, string> = new Map();

function updateEnvironment(
	context: vscode.ExtensionContext,
	envs: Map<string, string>,
	removedEnvs: [string, string][],
) {
	context.environmentVariableCollection.description =
		"Provide environment variables from `mise env`";
	for (const [name, value] of envs.entries()) {
		process.env[name] = value;
		context.environmentVariableCollection.replace(name, value);
	}

	for (const [name] of removedEnvs) {
		process.env[name] = undefined;
		context.environmentVariableCollection.delete(name);
	}
}

function updateTerminalsEnvs(variablesToRemove: [string, string][]) {
	const commands = variablesToRemove.map(([name]) => `;unset ${name}`).join("");
	const isTerminalFocused = vscode.window.activeTerminal !== undefined;

	const isMiseTask =
		vscode.window.activeTerminal?.creationOptions?.name?.includes("mise");
	if (isTerminalFocused && !isMiseTask) {
		return vscode.commands.executeCommand("workbench.action.terminal.relaunch");
	}

	const commandLine = ` ${commands}; eval "$(mise env)"; clear; # mise-vscode: env. updated. Run 'terminal: relaunch active terminal' to remove obsolete env variables.`;

	for (const terminal of vscode.window.terminals) {
		if (terminal.name.startsWith("mise-watch")) {
			continue;
		}

		void runInVscodeTerminal(terminal, commandLine);
	}
}

export async function updateEnv(
	context: vscode.ExtensionContext,
	miseService: MiseService,
) {
	if (!isMiseExtensionEnabled() || !shouldUpdateEnv()) {
		return;
	}

	const currentEnvs = new Map(
		(await miseService.getEnvs())
			.filter(({ name }) => name !== "PATH")
			.map(({ name, value }) => [name, value]),
	);

	if (previousEnvs.size === 0) {
		updateEnvironment(context, currentEnvs, []);
	} else {
		const variablesToRemove = [...previousEnvs.entries()].filter(
			([name]) => !currentEnvs.has(name),
		);
		const shouldUpdateTerminal =
			variablesToRemove.length > 0 ||
			[...currentEnvs.entries()].some(([name, value]) => {
				if (!previousEnvs.has(name)) {
					logger.info(`New env: ${name}=${value}`);
					return true;
				}
				if (previousEnvs.get(name) !== value) {
					logger.info(`Env changed: ${name}=${value}`);
					return true;
				}
				return false;
			});

		updateEnvironment(context, currentEnvs, variablesToRemove);
		if (shouldAutomaticallyReloadTerminalEnv() && shouldUpdateTerminal) {
			updateTerminalsEnvs(variablesToRemove);
		}
	}

	previousEnvs = new Map(currentEnvs);
}
