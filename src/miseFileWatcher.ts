import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "./configuration";
import type { MiseService } from "./miseService";
import { logger } from "./utils/logger";
import {
	allowedFileTaskDirs,
	idiomaticFiles,
	misePatterns,
} from "./utils/miseUtilts";

export class MiseFileWatcher {
	private readonly fileWatchers: vscode.FileSystemWatcher[];
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
		this.fileWatchers = [];
	}

	initialize() {
		this.initializeFileWatcher().catch((error) => {
			logger.info("Unable to initialize file watcher", { error });
		});
	}

	private async initializeFileWatcher() {
		this.dispose();

		const rootFolders = vscode.workspace.workspaceFolders;
		if (!rootFolders?.length) {
			logger.info(
				"No workspace folders found, skipping file watcher initialization",
			);
			return;
		}

		const patterns = [];
		for (const rootFolder of rootFolders) {
			const miseStandardConfigsPattern = new vscode.RelativePattern(
				rootFolder,
				`{${misePatterns}}`,
			);
			patterns.push(miseStandardConfigsPattern);

			const configFiles = await this.miseService.getMiseConfigFiles();
			for (const file of configFiles) {
				const miseDetectedConfigs = new vscode.RelativePattern(
					vscode.Uri.file(file.path),
					"*",
				);
				patterns.push(miseDetectedConfigs);
			}

			const idiomaticFilesPattern = new vscode.RelativePattern(
				rootFolder,
				`{${[...idiomaticFiles].join(",")}}`,
			);
			patterns.push(idiomaticFilesPattern);

			const taskDirsPattern = new vscode.RelativePattern(
				rootFolder,
				`{${allowedFileTaskDirs.map((dir) => `${dir}/**/*`)}}`,
			);
			patterns.push(taskDirsPattern);

			const tasksSources = await this.miseService.getAllCachedTasksSources();
			for (const taskSource of tasksSources) {
				const taskSourcePattern = new vscode.RelativePattern(
					vscode.Uri.file(taskSource),
					"*",
				);
				patterns.push(taskSourcePattern);
			}
		}

		for (const pattern of patterns) {
			this.fileWatchers.push(vscode.workspace.createFileSystemWatcher(pattern));
		}

		for (const watcher of this.fileWatchers) {
			this.context.subscriptions.push(watcher);
			watcher.onDidChange(this.handleFileChange.bind(this));
			watcher.onDidCreate(this.handleFileChange.bind(this));
			watcher.onDidDelete(this.handleFileChange.bind(this));
		}

		logger.info("File watchers initialized");
		logger.debug(patterns.map((p) => [p.baseUri.fsPath, p.pattern]));
	}

	private async handleFileChange(uri: vscode.Uri) {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		try {
			await this.onConfigChangeCallback(uri);
		} catch (error) {
			logger.info(`Error while handling file change ${error}`);
		}
	}

	public dispose() {
		for (const watcher of this.fileWatchers) {
			watcher.dispose();
		}
	}
}
