import * as vscode from "vscode";
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
		const envs = await this.miseService.getEnvs();
		return envs.map((env) => new EnvItem(env));
	}
}

class EnvItem extends vscode.TreeItem {
	constructor(env: MiseEnv) {
		const label = env.value ? `${env.name}=${env.value}` : env.name;
		super(label, vscode.TreeItemCollapsibleState.None);
	}
}
