import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "toml-v1";
import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "./configuration";
import type { MiseService } from "./miseService";
import {
	collectLocalIncludes,
	getMiseRcPaths,
	readIncludeEntries,
} from "./utils/configIncludes";
import {
	createFileChangeTracker,
	expandPath,
	isWindows,
} from "./utils/fileUtils";
import { logger } from "./utils/logger";
import {
	allowedFileTaskDirs,
	idiomaticFiles,
	isMiseConfigPath,
	misePatterns,
} from "./utils/miseUtilts";

/** The miserc files of a workspace folder, see {@link getMiseRcPaths} */
function getWorkspaceMiseRcFiles(folder: string): string[] {
	const home = os.homedir();
	return getMiseRcPaths({
		cwd: folder,
		home,
		// mise reads an empty variable as unset
		configDir:
			process.env.MISE_CONFIG_DIR ||
			path.join(
				process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
				"mise",
			),
		systemConfigDir:
			process.env.MISE_SYSTEM_CONFIG_DIR ||
			process.env.MISE_SYSTEM_DIR ||
			(isWindows ? undefined : "/etc/mise"),
		ceilingPaths: (process.env.MISE_CEILING_PATHS ?? "")
			.split(path.delimiter)
			.filter(Boolean),
	});
}

/**
 * The config files of a workspace folder, read from disk: mise lists none of
 * them while an include is broken. Only the folders mise reads configs from
 * are listed, not the whole tree.
 */
export async function findStandardConfigFiles(
	folder: string,
): Promise<string[]> {
	const dirs = [
		"",
		".config",
		path.join(".config", "mise"),
		"mise",
		".mise",
		path.join(".config", "mise", "conf.d"),
		path.join("mise", "conf.d"),
		path.join(".mise", "conf.d"),
	].map((dir) => path.join(folder, dir));
	const files = await Promise.all(
		dirs.map(async (dir) => {
			try {
				return (await readdir(dir)).map((name) => path.join(dir, name));
			} catch {
				return [];
			}
		}),
	);
	return files
		.flat()
		.filter((file) => file.endsWith(".toml") && isMiseConfigPath(file));
}

/**
 * A config file, parsed, or undefined when it cannot be read. The parser does
 * not read every file mise does (TOML 1.1): their `include` is read as text.
 */
async function readConfigFile(filePath: string): Promise<unknown> {
	let source: string;
	try {
		source = await readFile(filePath, "utf8");
	} catch {
		return undefined;
	}
	try {
		return parse(source);
	} catch (error) {
		logger.debug(`Reading the include of ${filePath} as text: ${error}`);
		return { include: readIncludeEntries(source) };
	}
}

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

	/**
	 * The reload reads the configs with mise, which a watcher can report as a
	 * change. A file is first seen with its first event: two initializations
	 * run at once on activation, and an await before the watchers exist would
	 * let both create them.
	 */
	private readonly hasChanged = createFileChangeTracker();

	private async initializeFileWatcher() {
		const rootFolders = vscode.workspace.workspaceFolders;
		if (!rootFolders?.length) {
			logger.info(
				"No workspace folders found, skipping file watcher initialization",
			);
			return;
		}

		// mise refuses an untrusted config, and one that does not parse: the
		// standard config names are watched anyway, so that the change fixing it
		// is picked up
		const [configFiles, tasksSources, envs] = await Promise.all([
			this.miseService.getMiseConfigFiles().catch(() => []),
			this.miseService.getAllCachedTasksSources().catch(() => []),
			this.miseService.getEnvWithInfoIncludingMonorepo().catch(() => []),
		]);

		const envSources = envs
			.map((env) => env.source ?? "")
			.filter((source) => source !== "");
		// the files mise lists are not enough: when an include is broken, mise
		// fails before listing any, and it does not list monorepo projects
		const standardConfigs = (
			await Promise.all(
				rootFolders.map((rootFolder) =>
					findStandardConfigFiles(rootFolder.uri.fsPath),
				),
			)
		).flat();
		const includedFiles = await collectLocalIncludes(
			[
				...configFiles.map((c) => c.path),
				...tasksSources,
				...envSources,
				...standardConfigs,
			].filter((configPath) => configPath.endsWith(".toml")),
			readConfigFile,
		);

		const idiomaticFilesValues = [...idiomaticFiles.values()];
		const filesToWatch = [
			...new Set([
				...configFiles.map((c) => c.path),
				...includedFiles,
				...rootFolders.flatMap((rootFolder) =>
					getWorkspaceMiseRcFiles(rootFolder.uri.fsPath),
				),
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
			watcher.onDidChange((uri) => this.handleFileChange(uri, "change"));
			watcher.onDidCreate((uri) => this.handleFileChange(uri, "create"));
			watcher.onDidDelete((uri) => this.handleFileChange(uri, "delete"));
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

		let source: string;
		try {
			// what mise reads: an open editor only catches up with a write from
			// outside (git, a terminal) after the watcher has reported it
			source = await readFile(uri.fsPath, "utf8");
		} catch {
			// a deleted file is a real change, not an edit
			return false;
		}
		try {
			// mise reads a file starting with a byte order mark, the parser does not
			parse(source.replace(/^﻿/, ""));
			this.miseService.setConfigFileParses(uri, true);
			return false;
		} catch {
			this.miseService.setConfigFileParses(uri, false);
			logger.debug(`Ignoring ${uri.fsPath} until it parses again`);
			return true;
		}
	}

	private async handleFileChange(
		uri: vscode.Uri,
		event: "change" | "create" | "delete",
	) {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		try {
			// a root config matches two watchers, and the second event is skipped
			// too. A created or deleted file is always handled.
			const changed = await this.hasChanged(uri.fsPath);
			if (!changed && event === "change") {
				return;
			}

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
		// a later initialization subscribes the watchers it creates, only
		this.fileWatchers.length = 0;
	}
}
