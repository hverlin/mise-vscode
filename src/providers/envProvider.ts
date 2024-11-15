import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";

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

	async getChildren(): Promise<EnvItem[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		const envs = await this.miseService.getEnvs();
		return envs.map((env) => new EnvItem(env));
	}
}

class EnvItem extends vscode.TreeItem {
	constructor(public env: MiseEnv) {
		const label = env.value ? `${env.name}=${env.value}` : env.name;
		super(label, vscode.TreeItemCollapsibleState.None);

		this.contextValue = "envItem";
	}
}

export function registerEnvsCommands(
	context: vscode.ExtensionContext,
	miseService: MiseService,
) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"mise.copyEnvVariableName",
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
			"mise.copyEnvVariableValue",
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
	);
}
