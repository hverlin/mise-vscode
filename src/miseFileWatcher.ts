import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "./configuration";
import type { MiseService } from "./miseService";
import { logger } from "./utils/logger";
import { misePatterns } from "./utils/miseUtilts";

export class MiseFileWatcher {
	private fileWatcher: vscode.FileSystemWatcher | undefined;
	private context: vscode.ExtensionContext;
	private miseService: MiseService;
	private readonly onConfigChangeCallback: (uri: vscode.Uri) => Promise<void>;

	constructor(
		context: vscode.ExtensionContext,
		miseService: MiseService,
		onConfigChangeCallback: (uri: vscode.Uri) => Promise<void>,
	) {
		this.context = context;
		this.miseService = miseService;
		this.onConfigChangeCallback = onConfigChangeCallback;
		this.initializeFileWatcher();
	}

	private initializeFileWatcher() {
		const rootFolder = vscode.workspace.workspaceFolders?.[0];
		if (!rootFolder) {
			return;
		}

		const pattern = new vscode.RelativePattern(rootFolder, `{${misePatterns}}`);
		this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

		this.context.subscriptions.push(this.fileWatcher);

		this.fileWatcher.onDidChange(this.handleFileChange.bind(this));
		this.fileWatcher.onDidCreate(this.handleFileChange.bind(this));
		this.fileWatcher.onDidDelete(this.handleFileChange.bind(this));
	}

	private async handleFileChange(uri: vscode.Uri) {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		try {
			const { stdout } = await this.miseService.execMiseCommand("tasks ls");

			if (stdout) {
				await this.onConfigChangeCallback(uri);
			}
		} catch (error) {
			logger.info(`Error while handling file change ${error}`);
		}
	}

	public dispose() {
		this.fileWatcher?.dispose();
	}
}
