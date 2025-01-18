import type vscode from "vscode";
import type { MiseService } from "../miseService";

export class MiseTextDocumentContentProvider
	implements vscode.TextDocumentContentProvider
{
	onDidChange?: vscode.Event<vscode.Uri>;

	constructor(private miseService: MiseService) {
		this.miseService = miseService;
	}

	async provideTextDocumentContent(uri: vscode.Uri) {
		if (uri.path === "/MISE_PATH") {
			const possibleEnvs = await this.miseService.getEnvs();
			const pathEnv = possibleEnvs.find((env) => env.name === "PATH");
			if (!pathEnv) {
				return;
			}

			return `${pathEnv.value.split(":").join("\n")}\n`;
		}

		return await this.miseService.miseDoctor();
	}
}
