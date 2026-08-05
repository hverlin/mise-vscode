import path from "node:path";
import { parse } from "toml-v1";
import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "./configuration";
import type { MiseService } from "./miseService";
import { expandPath } from "./utils/fileUtils";
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

	private lastWatchedHash = "";

	private async initializeFileWatcher() {
		const rootFolders = vscode.workspace.workspaceFolders;
		if (!rootFolders?.length) {
			logger.info(
				"No workspace folders found, skipping file watcher initialization",
			);
			return;
		}

		const [configFiles, tasksSources, envs] = await Promise.all([
			this.miseService.getMiseConfigFiles(),
			this.miseService.getAllCachedTasksSources(),
			this.miseService.getEnvWithInfoIncludingMonorepo(),
		]);

		const envSources = envs
			.map((env) => env.source ?? "")
			.filter((source) => source !== "");

		const idiomaticFilesValues = [...idiomaticFiles.values()];
		const filesToWatch = [
			...new Set([
				...configFiles.map((c) => c.path),
				...tasksSources,
				...envSources,
				...rootFolders.flatMap((rf) =>
					idiomaticFilesValues.map((f) =>
						expandPath(path.join(rf.uri.fsPath, f)),
					),
				),
			]),
		].sort();

		const currentHash = filesToWatch.join("|");
		if (this.lastWatchedHash === currentHash && this.fileWatchers.length > 0) {
			return;
		}

		this.lastWatchedHash = currentHash;
		this.dispose();

		const patterns: vscode.RelativePattern[] = [];

		for (const rootFolder of rootFolders) {
			const miseStandardConfigsPattern = new vscode.RelativePattern(
				rootFolder,
				`{${misePatterns}}`,
			);
			patterns.push(miseStandardConfigsPattern);

			const taskDirsPattern = new vscode.RelativePattern(
				rootFolder,
				`{${allowedFileTaskDirs.map((dir) => `${dir}/**/*`)}}`,
			);
			patterns.push(taskDirsPattern);
		}

		for (const file of filesToWatch) {
			const miseDetectedConfigs = new vscode.RelativePattern(
				vscode.Uri.file(file),
				"*",
			);
			patterns.push(miseDetectedConfigs);
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

	/**
	 * A config file saved mid-edit does not parse, and mise refuses to answer
	 * anything until it does. Reloading then would throw the current state away
	 * to replace it with nothing, so the change is ignored until the file parses
	 * again. With auto save on this is the common case, not the exception.
	 */
	private async isMidEdit(uri: vscode.Uri): Promise<boolean> {
		if (!uri.fsPath.endsWith(".toml")) {
			return false;
		}

		try {
			const document = await vscode.workspace.openTextDocument(uri);
			parse(document.getText());
			this.miseService.setConfigFileParses(uri, true);
			return false;
		} catch (error) {
			// a deleted file cannot be opened: that is a real change, not an edit
			if (error instanceof Error && error.message.includes("cannot open")) {
				return false;
			}
			this.miseService.setConfigFileParses(uri, false);
			logger.debug(`Ignoring ${uri.fsPath} until it parses again`);
			return true;
		}
	}

	private async handleFileChange(uri: vscode.Uri) {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		try {
			// a save the user asked for is always handled: they want to see what
			// their file does now, even when the answer is an error
			const manual = this.miseService.consumeManualSave(uri);
			if (!manual && (await this.isMidEdit(uri))) {
				return;
			}
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
