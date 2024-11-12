import * as vscode from "vscode";
import type { MiseService } from "./miseService";
import { logger } from "./utils/logger";

const misePatterns = [
	".config/mise/config.toml",
	"mise/config.toml",
	"mise.toml",
	".mise/config.toml",
	".mise.toml",
	".config/mise/config.local.toml",
	"mise/config.local.toml",
	"mise.local.toml",
	".mise/config.local.toml",
	".mise.local.toml",
	".config/mise/config.*.toml",
	"mise/config.*.toml",
	"mise.*.toml",
	".mise/config.*.toml",
	".mise.*.toml",
	".config/mise/config.*.local.toml",
	"mise/config.*.local.toml",
	".mise/config.*.local.toml",
	".mise.*.local.toml",
].join(",");

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
