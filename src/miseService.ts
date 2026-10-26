import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
	readdir,
	readFile,
	readlink,
	realpath,
	rm,
	stat,
	symlink,
} from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { createCache } from "async-cache-dedupe";
import { parse } from "toml-v1";
import * as vscode from "vscode";
import { MISE_RELOAD } from "./commands";
import {
	CONFIGURATION_FLAGS,
	getCommandTTLCacheSeconds,
	getConfiguredBinPath,
	getConfiguredSymLinksFolder,
	getCurrentWorkspaceFolderPath,
	getMiseEnv,
	isBinPathSetByWorkspace,
	isMiseExtensionEnabled,
	shouldAutomaticallyTrustMiseConfigFiles,
	shouldCheckForNewMiseVersion,
	shouldKeepReplacedVersionOnUpgrade,
	shouldResolveMonorepoProjectConfigs,
	shouldSkipWorkspaceBinaryApproval,
	shouldTrustOwnEditsInParanoidMode,
	updateBinPath,
} from "./configuration";
import { buildAffectedRunFlags } from "./utils/affectedTasks";
import type { ConfigKeyExplanation } from "./utils/configExplain";
import {
	displayPathRelativeTo,
	expandPath,
	hashFile,
	isPathInside,
	isWindows,
	mkdirp,
} from "./utils/fileUtils";
import { uniqBy } from "./utils/fn";
import {
	findToolDeclaration,
	getMissingTools,
	isLazyToolDeclaration,
} from "./utils/lazyTools";
import type { LockfileChange } from "./utils/lockfile";
import { logger } from "./utils/logger";
import {
	resolveMisePath,
	WorkspaceBinaryNotApprovedError,
} from "./utils/miseBinLocator";
import { expandConfig } from "./utils/miseDoctorParser";
import {
	compareVersions,
	findUntrustedConfigs,
	findUntrustedEnvFiles,
	flattenJsonSchema,
	idiomaticFiles,
	idiomaticFileToTool,
	isMiseAutoUpdateOn,
	isMiseConfigParseError,
	isMiseConfigPath,
	isNewerMiseVersion,
	isToolVersionsFile,
	type ParanoidCategory,
	parseMiseVersion,
	parseParanoidSetting,
	toWebUrl,
} from "./utils/miseUtilts";
import { showSettingsNotification } from "./utils/notify";
import {
	buildProjectsData,
	configsFromLsAllSources,
	findMiseConfigsInDir,
	type MiseLsAllSourcesOutput,
	parseToolVersionsContent,
} from "./utils/projectsUtils";
import {
	buildShellCommand,
	isTerminalClosed,
	runInVscodeTerminal,
	safeExec,
} from "./utils/shell";
import {
	getSymlinkedPathMappings,
	type PathMapping,
	toOpenedPaths,
} from "./utils/symlinkedPaths";
import {
	type MiseTaskInfo,
	parseTaskInfo,
	parseTaskInfoJson,
} from "./utils/taskInfoParser";
import { getConfigRootPaths } from "./utils/taskNames";
import {
	parseToolSearchResults,
	type ToolSearchResult,
} from "./utils/toolSearch";

// https://github.com/jdx/mise/blob/main/src/env.rs
const XDG_STATE_HOME =
	process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
const STATE_DIR =
	process.env.MISE_STATE_DIR ?? path.join(XDG_STATE_HOME, "mise");
const TRACKED_CONFIG_DIR = path.join(STATE_DIR, "tracked-configs");
/** where mise records the configs the user told it to ignore */
const IGNORED_CONFIG_DIR = path.join(STATE_DIR, "ignored-configs");

/** How long a file announced as an own edit waits for the write, in ms */
const OWN_EDIT_TTL_MS = 10_000;

/** sha256 of a file, undefined when it cannot be read */
async function digestFile(filePath: string): Promise<string | undefined> {
	try {
		return createHash("sha256")
			.update(await readFile(filePath))
			.digest("hex");
	} catch {
		return undefined;
	}
}

/** globalState key holding the workspace mise binaries the user approved */
export const APPROVED_WORKSPACE_BINARIES_KEY = "mise.approvedWorkspaceBinaries";

/** globalState key holding the folders scanned for the Projects webview */
export const PROJECT_SCAN_DIRECTORIES_KEY = "mise.projectScanDirectories";

const flattenSettings = (obj: object, prefix = "") => {
	const result: Record<string, MiseSettingInfo> = {};

	for (const [key, value] of Object.entries(obj)) {
		const newKey = prefix ? `${prefix}.${key}` : key;

		if (value && typeof value === "object" && !("value" in value)) {
			Object.assign(result, flattenSettings(value, newKey));
		} else {
			result[newKey] = value;
		}
	}

	return result;
};

const MIN_MISE_VERSION = [2025, 1, 5] as const;
// `mise bootstrap` (with `bootstrap status --json`) was consolidated in 2026.7.16
const MIN_MISE_VERSION_FOR_BOOTSTRAP = [2026, 7, 16] as const;
// `mise bootstrap plan` and the declarative resource sections (files,
// directories, services, firewall, compose, users/groups, secrets) landed in
// 2026.8.2
const MIN_MISE_VERSION_FOR_BOOTSTRAP_PLAN = [2026, 8, 2] as const;
// `mise upgrade --no-prune` was added in 2026.8.1
const MIN_MISE_VERSION_FOR_UPGRADE_NO_PRUNE = [2026, 8, 1] as const;
// `mise cache task` and `mise cache clear --task` were added in 2026.8.1
const MIN_MISE_VERSION_FOR_TASK_CACHE = [2026, 8, 1] as const;
// `mise run --affected` counts uncommitted changes and no longer needs
// `experimental = true` since 2026.10.6
const MIN_MISE_VERSION_FOR_AFFECTED_TASKS = [2026, 10, 6] as const;
// `mise tasks validate` was added in 2025.11.4
const MIN_MISE_VERSION_FOR_TASKS_VALIDATE = [2025, 11, 4] as const;
// `mise doctor project` and `[doctor.checks]` were added in 2026.9.6
const MIN_MISE_VERSION_FOR_PROJECT_CHECKS = [2026, 9, 6] as const;
const MIN_MISE_VERSION_FOR_CONFIG_EXPLAIN = [2026, 10, 14] as const;
const MIN_MISE_VERSION_FOR_REGISTRY_JSON = [2025, 12, 7] as const;
/** the registry changes with mise only: its descriptions are kept this long */
const REGISTRY_DESCRIPTIONS_TTL_MS = 10 * 60_000;
/** `mise search npm:...` (and `cargo:`, `gem:`, `dotnet:`) */
const MIN_MISE_VERSION_FOR_PACKAGE_SEARCH = [2026, 9, 13] as const;
/** `mise lock --dry-run --json`, `--bump`, `--upgrade`, and format 3 */
const MIN_MISE_VERSION_FOR_LOCKFILE_LENSES = [2026, 9, 16] as const;
/** a lockfile check that failed is not run again before this */
const LOCKFILE_CHECK_RETRY_MS = 60_000;
/** how long a hover uses the outdated tools listed for the editor */
const STALE_OUTDATED_TOOLS_MS = 60_000;

function isVersionGreaterOrEqualThan(
	version: readonly [number, number, number],
	target: readonly [number, number, number],
) {
	return compareVersions(version, target) >= 0;
}

function ensureMiseCommand(
	miseCommand: string | undefined,
): asserts miseCommand {
	if (!miseCommand) {
		throw new Error(
			"Mise binary path is not configured. [Install mise](https://mise.jdx.dev/getting-started.html)",
		);
	}
}

export class MiseService {
	private readonly context: vscode.ExtensionContext;
	private readonly eventEmitter: vscode.EventEmitter<void>;
	/** When set, mise runs from this directory instead of the selected folder */
	private readonly configRootOverride: string | undefined;
	constructor(
		context: vscode.ExtensionContext,
		{ configRootOverride }: { configRootOverride?: string } = {},
	) {
		this.context = context;
		this.configRootOverride = configRootOverride;
		this.eventEmitter = new vscode.EventEmitter();
	}

	/**
	 * A service bound to one workspace folder of a multi-root workspace: mise
	 * commands run from that folder, and tool symlinks land in its own symlink
	 * directory. The caches are separate too, so a result computed for one
	 * folder is never served for another.
	 */
	forWorkspaceFolder(folderPath: string): MiseService {
		const service = new MiseService(this.context, {
			configRootOverride: folderPath,
		});
		service._hasValidMiseBinPath = this._hasValidMiseBinPath;
		service.resolvedMiseBinPath = this.resolvedMiseBinPath;
		service.hasVerifiedMiseVersion = this.hasVerifiedMiseVersion;
		return service;
	}

	subscribeToReloadEvent(listener: () => void): vscode.Disposable {
		return this.eventEmitter.event(listener);
	}

	private readonly taskCacheEventEmitter = new vscode.EventEmitter<void>();

	/**
	 * Fired when the task output cache changed on disk, so the views showing it
	 * do not have to wait for a config change to refresh.
	 */
	subscribeToTaskCacheEvent(listener: () => void): vscode.Disposable {
		return this.taskCacheEventEmitter.event(listener);
	}

	async invalidateTaskCacheInfo() {
		await this.taskCacheCache.clear();
		this.taskCacheEventEmitter.fire();
	}

	private taskCacheWatcherStarted: Promise<void> | undefined;
	private taskCacheDebounce: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Start watching the task artifact cache, once. Cached tasks publish their
	 * entries outside of the workspace, and a task run from a terminal reports
	 * nothing back to the extension, so watching the artifacts is the only way
	 * the cache views know they went stale.
	 * Called when a task opting into the cache is first seen: resolving the
	 * directory costs a mise call, and most workspaces never need it.
	 */
	ensureTaskCacheWatcher() {
		if (this.taskCacheWatcherStarted) {
			return;
		}

		this.taskCacheWatcherStarted = this.startTaskCacheWatcher().catch(
			(error) => {
				logger.info("Unable to watch the task cache:", error as Error);
			},
		);
	}

	private async startTaskCacheWatcher() {
		const taskCacheDir = await this.getTaskCacheDir();
		if (!taskCacheDir) {
			return;
		}

		// mise only creates the directory when a task first publishes an entry,
		// and a watcher on a missing directory reports nothing
		await mkdirp(taskCacheDir);

		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.file(taskCacheDir), "**"),
		);
		this.context.subscriptions.push(watcher);

		// a single run writes an archive and a manifest: coalesce the events
		const onTaskCacheChange = () => {
			clearTimeout(this.taskCacheDebounce);
			this.taskCacheDebounce = setTimeout(() => {
				this.invalidateTaskCacheInfo().catch((error) => {
					logger.info("Error while refreshing the task cache:", error as Error);
				});
			}, 300);
		};

		watcher.onDidChange(onTaskCacheChange);
		watcher.onDidCreate(onTaskCacheChange);
		watcher.onDidDelete(onTaskCacheChange);
		logger.info(`Watching the task cache: ${taskCacheDir}`);
	}

	private hasVerifiedMiseVersion = false;
	private _hasValidMiseBinPath = false;
	/** The binary initializeMisePath resolved, approved if in the workspace */
	private resolvedMiseBinPath: string | undefined;
	private invalidMisePathErrorShown = false;
	get hasValidMiseBinPath(): boolean {
		return this._hasValidMiseBinPath;
	}

	private terminals: Map<string, vscode.Terminal | undefined> = new Map();

	getCurrentWorkspaceFolderPath() {
		return (
			this.configRootOverride ?? getCurrentWorkspaceFolderPath(this.context)
		);
	}

	private pathMappings: { key: string; mappings: PathMapping[] } | undefined;

	/**
	 * mise reports the real path of a file, and vscode the path the workspace
	 * was opened with: a project opened through a symlink would never compare
	 * equal with what mise says, nor open as the same document.
	 */
	private toOpenedPaths(output: string) {
		const folders = [
			...(vscode.workspace.workspaceFolders ?? [])
				.filter((folder) => folder.uri.scheme === "file")
				.map((folder) => folder.uri.fsPath),
			this.getCurrentWorkspaceFolderPath(),
		].filter((folder): folder is string => Boolean(folder));

		const key = folders.join("\0");
		if (this.pathMappings?.key !== key) {
			this.pathMappings = { key, mappings: getSymlinkedPathMappings(folders) };
		}
		return toOpenedPaths(output, this.pathMappings.mappings);
	}

	private dedupeCache = createCache({
		ttl: 0,
		storage: { type: "memory" },
	}).define("execCmd", ({ args, setMiseEnv, retainOnParseError } = {}) =>
		this.execMiseCommand(args, { setMiseEnv, retainOnParseError }),
	);

	private cache = createCache({
		ttl: getCommandTTLCacheSeconds(),
		storage: { type: "memory" },
	}).define("execCmd", ({ args, setMiseEnv, retainOnParseError } = {}) =>
		this.execMiseCommand(args, { setMiseEnv, retainOnParseError }),
	);

	private slowCache = createCache({
		ttl: 60,
		storage: { type: "memory" },
	}).define("execCmd", ({ args, setMiseEnv, retainOnParseError } = {}) =>
		this.execMiseCommand(args, { setMiseEnv, retainOnParseError }),
	);

	private longTTLCache = createCache({
		ttl: 60,
		storage: { type: "memory" },
	})
		.define("execCmd", ({ args, setMiseEnv, retainOnParseError } = {}) =>
			this.execMiseCommand(args, { setMiseEnv, retainOnParseError }),
		)
		.define("fetchSchema", async () => {
			const res = await fetch("https://mise.jdx.dev/schema/mise.json");
			if (!res.ok) {
				logger.warn(
					`Failed to fetch Mise schema (status: ${res.status})`,
					await res.text().catch(() => "Unknown error"),
				);
				return [];
			}
			const json = await res.json();
			return flattenJsonSchema(json.$defs.settings);
		});

	// task cache entries change whenever a cached task runs, which the config
	// file watcher cannot see: keep them briefly and invalidate on disk changes
	private taskCacheCache = createCache({
		ttl: 10,
		storage: { type: "memory" },
	}).define("getTaskCacheInfo", async () => {
		const { stdout } = await this.execMiseCommand(
			["cache", "task", "*", "--json"],
			{ retainOnParseError: true },
		);
		return stdout ? (JSON.parse(stdout) as MiseTaskCacheInfo[]) : [];
	});

	// scanning the project directories reads many files: keep the result for a
	// while instead of re-walking on every webview refresh
	private projectsCache = createCache({
		ttl: 60,
		storage: { type: "memory" },
	}).define("getProjects", () => this.loadProjectEntries());

	/**
	 * `mise bootstrap status` inspects the machine: it shells out to the package
	 * managers, `defaults`, docker and git, which costs far more than the default
	 * command ttl is meant for. The code lens re-renders on every keystroke, so
	 * the result is kept long enough that typing never spawns a subprocess.
	 *
	 * Everything the extension can observe invalidates this eagerly through
	 * `invalidateCache`: running bootstrap from the extension reloads on task
	 * end, and editing a config file reloads through the file watcher. What
	 * stays unobservable is the machine changing on its own (`brew install` in a
	 * terminal, `docker compose up`, `defaults write`), and the ttl is the only
	 * thing that recovers from that.
	 */
	private bootstrapCache = createCache({
		ttl: 30,
		storage: { type: "memory" },
	}).define("execCmd", ({ args, setMiseEnv, retainOnParseError } = {}) =>
		this.execMiseCommand(args, { setMiseEnv, retainOnParseError }),
	);

	async invalidateCache() {
		await Promise.all([
			this.dedupeCache.clear(),
			this.slowCache.clear(),
			this.cache.clear(),
			this.longTTLCache.clear(),
			this.projectsCache.clear(),
			this.taskCacheCache.clear(),
			this.bootstrapCache.clear(),
		]);
		this.configToolsCache.clear();
		this.recentOutdatedTools = undefined;
		this.lockfileCheckFailures.clear();
		this.eventEmitter.fire();
	}

	async initializeMisePath() {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		let miseBinaryPath = "mise";
		const previousPath = getConfiguredBinPath();

		try {
			miseBinaryPath = await resolveMisePath({
				// every folder counts, not only the selected one: a relative
				// binPath resolves against whichever folder holds the file
				workspaceRoots:
					vscode.workspace.workspaceFolders?.map(
						(folder) => folder.uri.fsPath,
					) ?? [],
				confirmWorkspaceBinary: (binPath) =>
					this.confirmWorkspaceBinary(binPath),
			});
			if (previousPath !== miseBinaryPath) {
				logger.info(`Mise binary path resolved to: ${miseBinaryPath}`);
				await updateBinPath(miseBinaryPath);
				if (previousPath) {
					void showSettingsNotification(
						`Mise binary path has been updated to: ${miseBinaryPath}`,
						{ settingsKey: "mise.binPath", type: "info" },
					);
				}
			}
		} catch (error) {
			if (error instanceof WorkspaceBinaryNotApprovedError) {
				// no fallback on purpose: the extension stays idle until the user
				// reviews the binary, instead of quietly using a different mise
				logger.info(error.message);
				this._pendingBinaryApproval = error.binPath;
				this._hasValidMiseBinPath = false;
				return;
			}

			if (!this.invalidMisePathErrorShown) {
				void showSettingsNotification(
					"Invalid configured mise bin path. Please configure the binary path.",
					{ settingsKey: "mise.binPath", type: "error" },
				);
				this.invalidMisePathErrorShown = true;
			}
			logger.info("Failed to resolve mise binary path", error);
			this._hasValidMiseBinPath = false;
			return;
		}

		this._pendingBinaryApproval = undefined;
		this.resolvedMiseBinPath = miseBinaryPath;
		this._hasValidMiseBinPath = true;
		if (!this.hasVerifiedMiseVersion) {
			const version = await this.getVersion();
			if (!version || version.includes("not configured")) {
				return;
			}
			const hasValidMiseVersion = await this.hasValidMiseVersion();
			if (!hasValidMiseVersion) {
				const canSelfUpdate = await this.canSelfUpdate();

				const selection = await vscode.window.showErrorMessage(
					`Mise version ${version} is not supported. Please update to a supported version.`,
					{ modal: true },
					canSelfUpdate ? "Run mise self-update" : "open mise website",
				);
				this.hasVerifiedMiseVersion = true;
				if (selection === "Run mise self-update") {
					await this.runMiseToolActionInConsole(["self-update", "-y"]);
				}
				if (selection === "open mise website") {
					await vscode.env.openExternal(
						vscode.Uri.parse("https://mise.jdx.dev/installing-mise.html"),
					);
				}
			}
		}
	}

	/** Paths refused in this window, so a reload does not ask again */
	private readonly refusedWorkspaceBinaries = new Set<string>();

	private _pendingBinaryApproval: string | undefined;

	/** Set while a workspace mise binary is waiting for the user's decision */
	get pendingBinaryApproval(): string | undefined {
		return this._pendingBinaryApproval;
	}

	/** Ask about the refused binary again, for the "review" status bar entry */
	async reviewWorkspaceBinary(): Promise<void> {
		if (this._pendingBinaryApproval) {
			this.refusedWorkspaceBinaries.delete(this._pendingBinaryApproval);
		}
	}

	private getApprovedWorkspaceBinaries(): Record<string, string> {
		return this.context.globalState.get<Record<string, string>>(
			APPROVED_WORKSPACE_BINARIES_KEY,
			{},
		);
	}

	/** Approved workspace binaries, for the revoke command */
	listApprovedWorkspaceBinaries(): string[] {
		return Object.keys(this.getApprovedWorkspaceBinaries()).sort();
	}

	/** Drop stored approvals so the next resolution asks again */
	async revokeWorkspaceBinaryApprovals(binPaths: string[]): Promise<void> {
		const approved = { ...this.getApprovedWorkspaceBinaries() };
		for (const binPath of binPaths) {
			delete approved[binPath];
			this.refusedWorkspaceBinaries.delete(binPath);
		}
		await this.context.globalState.update(
			APPROVED_WORKSPACE_BINARIES_KEY,
			approved,
		);
	}

	/**
	 * A mise binary living in the workspace is code shipped by the repository:
	 * running it is the repository's code running, so it is approved once by
	 * the user and the answer is remembered across windows.
	 *
	 * The approval is tied to the contents of the binary, not only to its path,
	 * so a project that swaps the file after being approved has to ask again.
	 */
	private async confirmWorkspaceBinary(binPath: string): Promise<boolean> {
		// opt-out for projects that ship a launcher on purpose, e.g. the script
		// written by `mise generate bootstrap -l -w`. Machine scoped, so this is
		// the user's own decision and never the project's.
		if (shouldSkipWorkspaceBinaryApproval()) {
			logger.info(
				`Running the workspace mise binary without approval, ${CONFIGURATION_FLAGS.skipWorkspaceBinaryApproval} is enabled: ${binPath}`,
			);
			return true;
		}

		if (this.refusedWorkspaceBinaries.has(binPath)) {
			return false;
		}

		const approved = this.getApprovedWorkspaceBinaries();
		const currentHash = await hashFile(binPath);
		const approvedHash = approved[binPath];

		if (currentHash && approvedHash === currentHash) {
			return true;
		}

		const changedSinceApproval = Boolean(approvedHash && currentHash);
		if (changedSinceApproval) {
			logger.info(`The approved mise binary changed on disk: ${binPath}`);
		}

		const allow = "Allow and run it";
		const inspectSettings = "Inspect settings.json";

		const setByWorkspace = isBinPathSetByWorkspace();
		const origin = setByWorkspace
			? "This path is set by this project's own .vscode/settings.json, not by your user settings. Inspect that file before allowing it."
			: "This path comes from your own settings.";

		const title = changedSinceApproval
			? "The mise binary of this workspace changed since you approved it."
			: "This workspace is configured to use a mise binary from the project folder.";

		const selection = await vscode.window.showWarningMessage(
			title,
			{
				modal: true,
				detail: `${binPath}\n\n${origin}\n\nRunning it executes a program shipped with this project, not the mise installed on your machine. Only allow this if you trust the project.`,
			},
			...(setByWorkspace ? [inspectSettings, allow] : [allow]),
		);

		if (selection === inspectSettings) {
			await vscode.commands.executeCommand(
				"workbench.action.openWorkspaceSettingsFile",
			);
			this.refusedWorkspaceBinaries.add(binPath);
			return false;
		}

		if (selection !== allow) {
			this.refusedWorkspaceBinaries.add(binPath);
			return false;
		}

		if (!currentHash) {
			// an unreadable binary cannot be pinned, so it is not remembered
			logger.warn(`Approved ${binPath} but it could not be hashed`);
			return true;
		}

		await this.context.globalState.update(APPROVED_WORKSPACE_BINARIES_KEY, {
			...approved,
			[binPath]: currentHash,
		});
		return true;
	}

	/**
	 * Output of the last successful run of a read-only command, served again
	 * while a config file is mid-edit. See {@link execMiseCommand}.
	 */
	private readonly lastGoodOutput = new Map<
		string,
		{ stdout: string; stderr: string }
	>();

	/** Config files saved by hand and not yet handled by the file watcher */
	private readonly manualSaves = new Set<string>();

	/**
	 * Config files about to be written by the user, trusted until then, with the
	 * time after which the write is no longer expected
	 */
	private readonly ownEdits = new Map<string, number>();

	/** Trust renewals of {@link ownEdits} in progress, by file */
	private readonly ownEditTrusts = new Map<string, Promise<void>>();

	/**
	 * The env files mise loads (`env._.file`, `env._.source`, `env_file`), as
	 * reported in the sources of the env or in a refusal to load one
	 */
	private readonly envFiles = new Set<string>();

	/** Whether mise loads this file for the env, see {@link envFiles} */
	isEnvFile(filePath: string): boolean {
		return this.envFiles.has(expandPath(filePath));
	}

	/**
	 * The digest of the content of each env file mise accepted, read around a
	 * successful `mise env` (see {@link checkEnvFileTrust}). Before a save, the
	 * file is compared with it instead of asking mise again, which can take
	 * longer than VS Code waits before writing.
	 */
	private readonly trustedEnvFileDigests = new Map<string, string>();

	/** The checks of {@link checkEnvFileTrust}, once per edit of a file */
	private readonly envFileTrustChecks = new Map<string, Promise<void>>();

	/**
	 * When the user starts editing an env file: whether mise accepts the file
	 * as it is on disk, for {@link expectOwnEdit}. In paranoid mode, mise only
	 * loads an env file it trusts.
	 */
	checkEnvFileTrust(filePath: string): void {
		const key = expandPath(filePath);
		if (
			!this.isEnvFile(key) ||
			this.envFileTrustChecks.has(key) ||
			this.trustedEnvFileDigests.has(key)
		) {
			return;
		}

		const check = async () => {
			if (!(await this.shouldTrustOwnEdits("env_files"))) {
				return;
			}
			const before = await digestFile(key);
			const trusted = await this.isEnvFileTrusted(key);
			// the file could have changed while mise read it
			const after = await digestFile(key);
			if (trusted && before && before === after) {
				this.trustedEnvFileDigests.set(key, before);
			}
		};
		this.envFileTrustChecks.set(
			key,
			check().catch((error) => {
				logger.info(`Could not check the trust of ${key}:`, error as Error);
			}),
		);
	}

	/** An env file saved or reverted: its next edit checks its trust again */
	endEnvFileEdit(filePath: string) {
		this.envFileTrustChecks.delete(expandPath(filePath));
	}

	/**
	 * Whether the file on disk is the one the user saved in VS Code: an env
	 * file is trusted again only then, not after a write from outside that
	 * happened around the save
	 */
	private async isSavedInEditor(filePath: string): Promise<boolean> {
		const document = vscode.workspace.textDocuments.find(
			(candidate) => expandPath(candidate.uri.fsPath) === filePath,
		);
		if (!document || document.isDirty) {
			return false;
		}
		try {
			return (await readFile(filePath, "utf8")) === document.getText();
		} catch {
			return false;
		}
	}

	/**
	 * Config files that did not parse the last time they were saved. mise does
	 * not always name the file in its error, so this is recorded where the file
	 * is parsed rather than read out of the message.
	 */
	private readonly unparsedConfigFiles = new Set<string>();

	setConfigFileParses(uri: vscode.Uri, parses: boolean) {
		const filePath = expandPath(uri.fsPath);
		if (parses) {
			this.unparsedConfigFiles.delete(filePath);
		} else {
			this.unparsedConfigFiles.add(filePath);
		}
	}

	/** Whether this config file failed to parse the last time it was saved */
	isConfigFileUnparsed(filePath: string): boolean {
		return this.unparsedConfigFiles.has(expandPath(filePath));
	}

	private _isServingRetainedState = false;

	private readonly retainedStateEmitter = new vscode.EventEmitter<boolean>();

	/**
	 * Whether the last reads were answered with the state kept from before a
	 * config file stopped parsing, rather than with what mise reports now.
	 */
	get isServingRetainedState(): boolean {
		return this._isServingRetainedState;
	}

	/** Fired when the views start, or stop, showing state kept from before */
	subscribeToRetainedStateChange(
		listener: (isRetained: boolean) => void,
	): vscode.Disposable {
		return this.retainedStateEmitter.event(listener);
	}

	private setServingRetainedState(isRetained: boolean) {
		if (this._isServingRetainedState === isRetained) {
			return;
		}
		this._isServingRetainedState = isRetained;
		this.retainedStateEmitter.fire(isRetained);
	}

	private readonly retainedDroppedEmitter = new vscode.EventEmitter<
		vscode.Uri | undefined
	>();

	/**
	 * Fired when what was kept from before has been dropped, so listeners drop
	 * theirs too. The uri is the config file it was dropped for, or undefined
	 * when everything was dropped at once.
	 */
	subscribeToRetainedStateDropped(
		listener: (uri: vscode.Uri | undefined) => void,
	): vscode.Disposable {
		return this.retainedDroppedEmitter.event(listener);
	}

	/**
	 * Drop everything kept from before a config file stopped parsing. Asking for
	 * a reload means asking for the state as it is now, errors included.
	 */
	forgetRetainedState(uri?: vscode.Uri) {
		this.lastGoodOutput.clear();
		this.setServingRetainedState(false);
		this.retainedDroppedEmitter.fire(uri);
	}

	/**
	 * Saving by hand is deliberate, unlike the auto save that lands in the middle
	 * of typing: the state kept to survive a half-written config is dropped, so
	 * the next read reports what the file says now, errors included.
	 */
	notifyManualSave(uri: vscode.Uri) {
		this.manualSaves.add(expandPath(uri.fsPath));
		this.forgetRetainedState(uri);
	}

	/**
	 * In paranoid mode, mise binds the trust of a config file to its content, so
	 * every write untrusts it. With `mise.trustOwnEditsInParanoidMode`, a file
	 * the user writes in vscode (a save, or an extension action such as
	 * formatting) is trusted again once written.
	 *
	 * Only a file trusted just before the write is: one changed outside vscode
	 * may hold changes the user has not reviewed, and saving over it does not
	 * approve them. Called before the write.
	 */
	async expectOwnEdit(filePath: string): Promise<void> {
		const key = expandPath(filePath);
		if (this.isEnvFile(key)) {
			this.endEnvFileEdit(key);
			// the write changes the content
			const digest = this.trustedEnvFileDigests.get(key);
			this.trustedEnvFileDigests.delete(key);
			if (
				digest &&
				(await this.shouldTrustOwnEdits("env_files")) &&
				digest === (await digestFile(key))
			) {
				this.ownEdits.set(key, Date.now() + OWN_EDIT_TTL_MS);
				return;
			}
			// a config file whose name mise does not use by default, e.g. the one of
			// MISE_GLOBAL_CONFIG_FILE, is also reported as a source of the env
		}

		if (!(await this.shouldTrustOwnEdits("config"))) {
			return;
		}

		const trust = await this.getConfigTrust(path.dirname(key));
		if (trust.get(key)) {
			this.ownEdits.set(key, Date.now() + OWN_EDIT_TTL_MS);
		}
	}

	/**
	 * Whether mise loads this env file now, so trusts it. mise lists only config
	 * files in `mise trust --show`: the env is read instead, which fails on the
	 * first env file that is not trusted. Not cached.
	 */
	private async isEnvFileTrusted(filePath: string): Promise<boolean> {
		try {
			const { stdout } = await this.execMiseCommand(["env", "--json-extended"]);
			const envs = JSON.parse(stdout) as Record<string, MiseEnvWithInfo>;
			return Object.values(envs).some(
				(env) => env.source && expandPath(env.source) === filePath,
			);
		} catch {
			return false;
		}
	}

	/** Same as {@link expectOwnEdit}, for the config files of a directory */
	private async expectOwnEditsIn(directory: string): Promise<string[]> {
		if (!(await this.shouldTrustOwnEdits("config"))) {
			return [];
		}

		const expected: string[] = [];
		for (const [file, trusted] of await this.getConfigTrust(directory)) {
			if (trusted && path.dirname(file) === expandPath(directory)) {
				this.ownEdits.set(file, Date.now() + OWN_EDIT_TTL_MS);
				expected.push(file);
			}
		}
		return expected;
	}

	/**
	 * Whether the files of a paranoid category the user writes are trusted
	 * again: config files, or env files
	 */
	private async shouldTrustOwnEdits(category: "config" | "env_files") {
		return (
			shouldAutomaticallyTrustMiseConfigFiles() &&
			shouldTrustOwnEditsInParanoidMode() &&
			vscode.workspace.isTrusted &&
			// outside paranoid mode, `mise trust <file>` trusts its whole directory,
			// and an env file needs no trust of its own
			((await this.getParanoidCategories())?.has(category) ?? false)
		);
	}

	private pendingOwnEdits(): string[] {
		const now = Date.now();
		for (const [file, expiresAt] of this.ownEdits) {
			if (expiresAt < now) {
				this.ownEdits.delete(file);
			}
		}
		return [...this.ownEdits.keys(), ...this.ownEditTrusts.keys()];
	}

	/**
	 * Trusts again a file announced by {@link expectOwnEdit}, now written. The
	 * save handler, the file watcher and the views all wait for the same
	 * renewal, whichever of them reads the file first.
	 */
	trustOwnEdit(filePath: string): Promise<void> {
		const key = expandPath(filePath);
		const pending = this.ownEditTrusts.get(key);
		if (pending) {
			return pending;
		}

		const expiresAt = this.ownEdits.get(key);
		this.ownEdits.delete(key);
		if (expiresAt === undefined || expiresAt < Date.now()) {
			return Promise.resolve();
		}

		const renew = async () => {
			if (this.isEnvFile(key) && !(await this.isSavedInEditor(key))) {
				logger.info(`Not trusting ${key}: it changed outside VS Code`);
				return;
			}
			await this.miseTrustFile(key);
		};
		const renewal = renew().finally(() => {
			this.ownEditTrusts.delete(key);
		});
		this.ownEditTrusts.set(key, renewal);
		return renewal;
	}

	/**
	 * `mise -C <directory> trust --show`: whether each config file mise reads
	 * there is trusted. In paranoid mode it lists files, ancestors included.
	 */
	private async getConfigTrust(
		directory: string,
	): Promise<Map<string, boolean>> {
		const trust = new Map<string, boolean>();
		try {
			const { stdout } = await this.execMiseCommand(
				["-C", directory, "trust", "--show"],
				{ setMiseEnv: false },
			);
			for (const line of stdout.split("\n")) {
				const match = line.trim().match(/^(.+): (trusted|untrusted)$/);
				if (match?.[1]) {
					trust.set(expandPath(match[1]), match[2] === "trusted");
				}
			}
		} catch (error) {
			logger.info(
				"Could not read the trust of the config files:",
				error as Error,
			);
		}
		return trust;
	}

	/**
	 * The config files the user told mise to ignore, with `mise trust --ignore`
	 * or by answering no to its trust prompt. mise skips them without an error.
	 */
	async getIgnoredConfigFiles(): Promise<Set<string>> {
		const entries: string[] = await readdir(IGNORED_CONFIG_DIR).catch(() => []);
		const files = new Set<string>();
		for (const entry of entries) {
			const entryPath = path.join(IGNORED_CONFIG_DIR, entry);
			// a symlink to the config, or a file holding its path on Windows
			const target = await readlink(entryPath)
				.catch(() => readFile(entryPath, "utf8"))
				.then((value) => value.trim())
				.catch(() => "");
			if (target) {
				files.add(expandPath(this.toOpenedPaths(target)));
			}
		}
		return files;
	}

	/** Whether a config of the workspace folder, or of a parent, is ignored */
	private async isWorkspaceConfigIgnored(): Promise<boolean> {
		const folder = this.getCurrentWorkspaceFolderPath();
		if (!folder) {
			return false;
		}
		const workspace = expandPath(folder);
		return [...(await this.getIgnoredConfigFiles())].some((file) => {
			const directory = path.dirname(file);
			return directory === workspace || isPathInside(directory, workspace);
		});
	}

	/** Whether this change comes from a save the user asked for */
	consumeManualSave(uri: vscode.Uri): boolean {
		return this.manualSaves.delete(expandPath(uri.fsPath));
	}

	/**
	 * Run mise and return its output. Arguments are passed as an argv array and
	 * never go through a shell, they may contain any character.
	 *
	 * @param retainOnParseError only for commands that read state. When a config
	 * file does not parse, every mise command fails, which with auto save on
	 * happens on nearly every keystroke. Read-only commands then serve their
	 * previous output so the views keep showing the last state the machine was
	 * actually in, instead of emptying until the file parses again. Any other
	 * failure still throws, so real errors are never masked.
	 * @param env the environment of mise, the extension's by default
	 */
	async execMiseCommand(
		args: string[],
		{
			setMiseEnv = true,
			retainOnParseError = false,
			env,
		}: {
			setMiseEnv?: boolean;
			retainOnParseError?: boolean;
			env?: NodeJS.ProcessEnv;
		} = {},
	) {
		const miseBinaryPath = this.getMiseBinaryPath();
		ensureMiseCommand(miseBinaryPath);

		const miseArgs = this.buildMiseArgs(args, { setMiseEnv });
		logger.debug(`> ${miseBinaryPath} ${miseArgs.join(" ")}`);

		const result = await safeExec(miseBinaryPath, miseArgs, {
			cwd: this.getCurrentWorkspaceFolderPath(),
			env,
		});
		const { code } = result;
		const stdout = this.toOpenedPaths(result.stdout);
		const stderr = this.toOpenedPaths(result.stderr);

		const key = miseArgs.join(" ");
		if (code !== 0) {
			const error = new Error(
				`Command failed: mise ${miseArgs.join(" ")}\n${stderr}`.trim(),
			);
			this.noteUntrustedConfigs(error.message);

			const previous = this.lastGoodOutput.get(key);
			if (retainOnParseError && previous && isMiseConfigParseError(error)) {
				logger.debug(
					`Config does not parse, serving the previous output of: mise ${key}`,
				);
				this.setServingRetainedState(true);
				return previous;
			}

			throw error;
		}

		if (retainOnParseError) {
			this.lastGoodOutput.set(key, { stdout, stderr });
			// the config parses again, so what the views show is current
			this.setServingRetainedState(false);
		}
		// e.g. the untrusted monorepo subprojects, skipped with a warning
		this.noteUntrustedConfigs(stderr);
		return { stdout, stderr };
	}

	/** Same as {@link execMiseCommand}, but never throws */
	private async execMiseCommandMergeOutput(
		args: string[],
		{ setMiseEnv = true } = {},
	) {
		const miseBinaryPath = this.getMiseBinaryPath();
		if (!miseBinaryPath) {
			return { stdout: "", stderr: "" };
		}

		const { stdout, stderr } = await safeExec(
			miseBinaryPath,
			this.buildMiseArgs(args, { setMiseEnv }),
			{ cwd: this.getCurrentWorkspaceFolderPath() },
		);
		return {
			stdout: this.toOpenedPaths(stdout),
			stderr: this.toOpenedPaths(stderr),
		};
	}

	async runMiseToolActionInConsole(
		args: string[],
		taskName?: string,
	): Promise<void> {
		try {
			const miseBinaryPath = this.getMiseBinaryPath();
			if (!miseBinaryPath) {
				logger.warn("Could not find mise binary");
				return;
			}

			const miseArgs = this.buildMiseArgs(args);
			logger.info(`> ${miseBinaryPath} ${miseArgs.join(" ")}`);

			// the arguments are quoted here rather than by vscode: its own
			// `ShellQuoting.Strong` does not escape quotes inside the value
			const execution = new vscode.ShellExecution(
				buildShellCommand(miseBinaryPath, miseArgs),
			);
			const task = new vscode.Task(
				{ type: "mise" },
				vscode.TaskScope.Workspace,
				taskName ?? `mise ${args.join(" ")}`,
				"mise",
				execution,
			);

			const p = new Promise((resolve) => {
				const disposable = vscode.tasks.onDidEndTask((e) => {
					if (e.execution.task === task) {
						vscode.commands.executeCommand(MISE_RELOAD);
						disposable.dispose();
						resolve(undefined);
					}
				});
			});
			await vscode.tasks.executeTask(task);
			return p as Promise<void>;
		} catch (error) {
			logger.error(`Failed to execute ${taskName}: ${error}`);
		}
	}

	public getMiseBinaryPath(): string | undefined {
		if (!this._hasValidMiseBinPath) {
			return;
		}

		// not the setting: when mise.binPath changes, it names the new binary
		// while its approval is still pending, and a reload would run it
		return this.resolvedMiseBinPath;
	}

	/** Arguments of a mise invocation, with the configured environment applied */
	public buildMiseArgs(args: string[], { setMiseEnv = true } = {}): string[] {
		const miseEnv = getMiseEnv();
		const isUsePath = args[0] === "use" && args.includes("--path");
		if (!miseEnv || !setMiseEnv || isUsePath) {
			return args;
		}
		return ["--env", miseEnv, ...args];
	}

	/**
	 * Command line running mise in a terminal. Only for the places that need a
	 * shell command, prefer {@link execMiseCommand} everywhere else.
	 */
	public createMiseCommand(
		args: string[],
		{ setMiseEnv = true } = {},
	): string | undefined {
		const miseBinaryPath = this.getMiseBinaryPath();
		if (!miseBinaryPath) {
			return undefined;
		}

		return buildShellCommand(
			miseBinaryPath,
			this.buildMiseArgs(args, { setMiseEnv }),
		);
	}

	/** The config files mise refused to read because they are not trusted */
	private _untrustedConfigFiles: string[] = [];

	private readonly untrustedConfigEmitter = new vscode.EventEmitter<void>();

	get untrustedConfigFiles(): readonly string[] {
		return this._untrustedConfigFiles;
	}

	/** Fired when the list of untrusted config files changes */
	subscribeToUntrustedConfigChange(listener: () => void): vscode.Disposable {
		return this.untrustedConfigEmitter.event(listener);
	}

	private setUntrustedConfigFiles(files: string[]) {
		if (files.join("\n") === this._untrustedConfigFiles.join("\n")) {
			return;
		}
		this._untrustedConfigFiles = files;
		this.untrustedConfigEmitter.fire();
	}

	/** On each reload: what mise refuses is learned again */
	resetUntrustedConfigFiles() {
		this.setUntrustedConfigFiles([]);
	}

	/**
	 * mise refuses to read an untrusted config file, so every view fails at once
	 * when it loads. Each refusal is noted as it happens, without a notification:
	 * the status bar and a code lens show the files are not trusted, and the
	 * views go on without them.
	 */
	private noteUntrustedConfigs(output: string) {
		for (const envFile of findUntrustedEnvFiles(output)) {
			this.envFiles.add(expandPath(envFile));
		}
		const { refused, skipped } = findUntrustedConfigs(output);
		// a file just written by the user is about to be trusted again
		const pending = new Set(this.pendingOwnEdits());
		const files = [refused, ...skipped]
			.filter((file): file is string => Boolean(file))
			.map((file) => expandPath(file))
			.filter((file) => !pending.has(file));
		if (!files.length) {
			return;
		}

		logger.info("Untrusted config files:", files.join(", "));
		this.setUntrustedConfigFiles([
			...new Set([...this._untrustedConfigFiles, ...files]),
		]);
		this.findOtherUntrustedConfigs();
	}

	private findingOtherUntrustedConfigs: Promise<void> | undefined;

	/**
	 * In paranoid mode, each config file is trusted on its own and mise names
	 * one at a time, parents first: the others are listed at once, so that a
	 * single action trusts them all.
	 */
	private findOtherUntrustedConfigs() {
		this.findingOtherUntrustedConfigs ??= (async () => {
			const folder = this.getCurrentWorkspaceFolderPath();
			if (!folder || !(await this.isParanoidMode())) {
				return;
			}
			const ignored = await this.getIgnoredConfigFiles();
			const untrusted = [...(await this.getConfigTrust(folder))]
				.filter(([file, trusted]) => !trusted && !ignored.has(file))
				.map(([file]) => file);
			if (untrusted.length) {
				this.setUntrustedConfigFiles([
					...new Set([...this._untrustedConfigFiles, ...untrusted]),
				]);
			}
		})().finally(() => {
			this.findingOtherUntrustedConfigs = undefined;
		});
	}

	/**
	 * A file the user just wrote may be the one mise refused: it is trusted
	 * again if they opted in (see {@link expectOwnEdit}).
	 *
	 * @returns whether the caller should read the config again
	 */
	private async handleUntrustedFile(): Promise<boolean> {
		const pending = this.pendingOwnEdits();
		if (!pending.length) {
			return false;
		}

		await Promise.all(pending.map((filePath) => this.trustOwnEdit(filePath)));
		return true;
	}

	private describeConfigFile(filePath: string) {
		return displayPathRelativeTo(
			filePath,
			this.getCurrentWorkspaceFolderPath(),
		);
	}

	/** Trust the config files mise refuses, or read them first */
	async reviewUntrustedConfig() {
		const files = [...this._untrustedConfigFiles];
		if (!files.length) {
			void vscode.window.showInformationMessage(
				"No mise config file is waiting to be trusted.",
			);
			return;
		}

		const names = files.map((file) => this.describeConfigFile(file));
		const isSingle = files.length === 1;
		const trustAction = isSingle ? "Trust" : "Trust All";
		const openAction = isSingle ? "Open File" : "Open Files";
		const selection = await vscode.window.showInformationMessage(
			isSingle
				? `mise does not load ${names[0]} until you trust it.`
				: "mise does not load these files until you trust them.",
			{
				modal: true,
				detail: [
					...(isSingle ? [] : [...names, ""]),
					...(files.some((file) => !this.isEnvFile(file))
						? [
								"Trusting a config file lets mise run what it defines: tasks, hooks and environment templates.",
							]
						: []),
					...(files.some((file) => this.isEnvFile(file))
						? [
								"Trusting an env file lets mise load its variables, or run it when it is a script. In paranoid mode, an edit untrusts it again.",
							]
						: []),
				].join("\n"),
			},
			trustAction,
			openAction,
		);

		if (selection === trustAction) {
			// the files shown: others may have been refused while it was open
			await this.trustUntrustedConfigs(files);
		} else if (selection === openAction) {
			for (const file of files) {
				await vscode.window.showTextDocument(vscode.Uri.file(file), {
					preview: false,
				});
			}
		}
	}

	/** A config file the user told mise to ignore: trust it after all */
	async reviewIgnoredConfig(filePath: string) {
		const trustAction = "Trust";
		const selection = await vscode.window.showInformationMessage(
			`mise ignores ${this.describeConfigFile(filePath)}, as you asked.`,
			{
				modal: true,
				detail:
					"Trusting it lets mise load it, and run what it defines: tasks, hooks and environment templates.",
			},
			trustAction,
		);
		if (selection !== trustAction) {
			return;
		}
		try {
			await this.execMiseCommand(["trust", filePath], { setMiseEnv: false });
		} catch (error) {
			logger.error(`Could not trust ${filePath}:`, error as Error);
			return;
		}
		await vscode.commands.executeCommand(MISE_RELOAD);
	}

	private async trustUntrustedConfigs(files: string[]) {
		const trusted: string[] = [];
		for (const file of files) {
			try {
				await this.execMiseCommand(["trust", file], { setMiseEnv: false });
				trusted.push(file);
			} catch (error) {
				logger.error(`Could not trust ${file}:`, error as Error);
			}
		}
		this.setUntrustedConfigFiles(
			this._untrustedConfigFiles.filter((file) => !trusted.includes(file)),
		);
		await vscode.commands.executeCommand(MISE_RELOAD);
	}

	/**
	 * In an untrusted VS Code workspace, the config files are not trusted yet:
	 * outside paranoid mode, {@link miseTrust} trusts them once the workspace is.
	 */
	async waitsForWorkspaceTrust(): Promise<boolean> {
		return (
			!vscode.workspace.isTrusted &&
			shouldAutomaticallyTrustMiseConfigFiles() &&
			(await this.trustsConfigsAutomatically())
		);
	}

	/**
	 * `mise trust` without asking, for `mise.automaticallyTrustMiseConfigFiles`.
	 *
	 * Skipped in paranoid mode, where trust is bound to the content of a file:
	 * every change has to be approved again, from the status bar or the code
	 * lens shown once mise refuses the edited file.
	 */
	async miseTrust() {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		if (!(await this.trustsConfigsAutomatically())) {
			logger.info(
				"mise runs in paranoid mode: config files are not trusted automatically",
			);
			return;
		}

		// `mise trust` would also remove a config from the ignore list
		if (await this.isWorkspaceConfigIgnored()) {
			logger.info(
				"A config file of the workspace is ignored by mise: not trusting it automatically",
			);
			return;
		}

		// with no path, `mise trust` also trusts the env files the config loads,
		// which paranoid mode has the user approve. With a directory, it only
		// trusts the config files.
		const folder = this.getCurrentWorkspaceFolderPath();
		const envFilesNeedTrust = (await this.getParanoidCategories())?.has(
			"env_files",
		);
		if (envFilesNeedTrust && !folder) {
			return;
		}
		await this.cache.execCmd({
			args: ["trust", ...(envFilesNeedTrust && folder ? [folder] : [])],
			setMiseEnv: false,
		});
	}

	/**
	 * `mise trust <file>`: that file only, not every config file of the folder.
	 * Not cached, since each save changes the content that gets trusted.
	 */
	async miseTrustFile(filePath: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		try {
			await this.execMiseCommand(["trust", filePath], { setMiseEnv: false });
		} catch (error) {
			logger.info(`Could not trust ${filePath}:`, error as Error);
		}
	}

	/**
	 * The categories of paranoid mode that are on (`paranoid = true`, or a list
	 * such as `["config", "env_files"]`). Undefined when mise cannot tell.
	 */
	async getParanoidCategories(): Promise<Set<ParanoidCategory> | undefined> {
		try {
			return parseParanoidSetting((await this.getSetting("paranoid")) ?? "");
		} catch (error) {
			logger.info("Could not read the paranoid setting:", error as Error);
			return undefined;
		}
	}

	/**
	 * Whether mise binds the trust of config files to their content, for what
	 * the editor shows
	 */
	async isParanoidMode(): Promise<boolean> {
		return (await this.getParanoidCategories())?.has("config") ?? false;
	}

	/**
	 * Whether config files may be trusted without asking: not when paranoid
	 * mode binds their trust to their content (`config`), nor when mise cannot
	 * tell, trusting being the unsafe side
	 */
	private async trustsConfigsAutomatically(): Promise<boolean> {
		const categories = await this.getParanoidCategories();
		return categories !== undefined && !categories.has("config");
	}

	private async buildTasksLsArgs({ includeHidden = false } = {}) {
		const args = ["tasks", "ls", "--json"];

		if (includeHidden) {
			args.push("--hidden");
		}

		// --all (added in 2025.10.3) loads tasks from every monorepo project
		if (await this.hasValidMiseVersion([2025, 10, 3])) {
			args.push("--all");
		}

		return args;
	}

	async getTasks(
		{ includeHidden }: { includeHidden?: boolean } = {
			includeHidden: false,
		},
	): Promise<MiseTask[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
				args: await this.buildTasksLsArgs({ includeHidden }),
				retainOnParseError: true,
			});
			return JSON.parse(stdout);
		} catch (error: unknown) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				if (await this.handleUntrustedFile()) {
					return this.getTasks();
				}
				return [];
			}

			logger.info("Error fetching mise tasks:", error as Error);
			return [];
		}
	}

	async getAllCachedTasks(): Promise<MiseTask[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.slowCache.execCmd({
			args: await this.buildTasksLsArgs({ includeHidden: true }),
			retainOnParseError: true,
		});
		return JSON.parse(stdout);
	}

	async getAllCachedTasksSources(): Promise<string[]> {
		const tasks = await this.getAllCachedTasks();
		return [...new Set(tasks.map((task) => task.source))];
	}

	/**
	 * Output cache entries of every task. `mise cache task '*'` reports all
	 * tasks in one call, with no entries for the ones that do not cache, and
	 * does not require the experimental flag to be enabled.
	 * Empty on mise versions without the subcommand.
	 */
	async getTaskCacheInfo(): Promise<MiseTaskCacheInfo[]> {
		if (!(await this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_TASK_CACHE))) {
			return [];
		}

		try {
			return await this.taskCacheCache.getTaskCacheInfo();
		} catch (error) {
			logger.info("Error fetching task cache entries:", error as Error);
			return [];
		}
	}

	/**
	 * Directory holding the task output cache artifacts, watched to know when a
	 * task published or restored an entry.
	 */
	async getTaskCacheDir(): Promise<string | undefined> {
		if (!(await this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_TASK_CACHE))) {
			return undefined;
		}

		// `settings get` fails when the setting has no value, which is the
		// default: fall back to the standard location under the mise cache dir
		const configuredDir = await this.getSetting("task.cache_dir")
			.then((dir) => dir?.trim())
			.catch(() => undefined);
		if (configuredDir) {
			return expandPath(configuredDir);
		}

		try {
			const { stdout } = await this.execMiseCommand(["cache", "path"]);
			const cacheDir = stdout.trim();
			return cacheDir
				? path.join(expandPath(cacheDir), "task-artifacts")
				: undefined;
		} catch (error) {
			logger.info(
				"Could not resolve the task cache directory:",
				error as Error,
			);
			return undefined;
		}
	}

	/**
	 * Cache key the task would use if it ran now, which is the only way to know
	 * whether the next run hits the cache: the `current` flag of the stored
	 * entries reports the last key mise recorded, not one recomputed from the
	 * inputs as they are now.
	 *
	 * Computing the key runs the `cache.command_inputs` of the task, so callers
	 * must only ask for tasks that declare none. Nothing else is executed: the
	 * dry run reports missing tools instead of installing them.
	 */
	async getTaskCacheKey(taskName: string): Promise<string | undefined> {
		if (!(await this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_TASK_CACHE))) {
			return undefined;
		}

		// outside paranoid mode, `mise run` trusts the config it runs: a hover
		// must not trust a config the user has not, or has chosen to ignore
		if (
			this._untrustedConfigFiles.length ||
			(await this.isWorkspaceConfigIgnored())
		) {
			return undefined;
		}

		try {
			// the explanations are JSON lines on stdout, task output goes to stderr
			const { stdout } = await this.dedupeCache.execCmd({
				args: ["run", "--dry-run", "--task-cache-explain-json", taskName],
			});
			for (const line of stdout.split("\n")) {
				if (!line.trim()) {
					continue;
				}
				const explanation = JSON.parse(line) as {
					task?: string;
					cache_key?: string;
				};
				if (explanation.task === taskName && explanation.cache_key) {
					return explanation.cache_key;
				}
			}
		} catch (error) {
			logger.info(
				`Could not compute the cache key of ${taskName}:`,
				error as Error,
			);
		}
		return undefined;
	}

	/** Cache entries of a single task, empty when it has none */
	async getTaskCacheEntries(taskName: string): Promise<MiseTaskCacheEntry[]> {
		const cacheInfo = await this.getTaskCacheInfo();
		return cacheInfo.find((info) => info.task === taskName)?.entries ?? [];
	}

	async clearTaskCacheInConsole(taskName: string) {
		await this.runMiseToolActionInConsole(
			["cache", "clear", "--task", taskName],
			`mise cache clear ${taskName}`,
		);
	}

	async getCurrentConfigFiles(): Promise<string[]> {
		const files = await Promise.all([
			this.getTasks().then((tasks) => tasks.map((task) => task.source)),
			this.getMiseConfigFiles().then((files) => files.map((file) => file.path)),
		]);

		return [...new Set(files.flat().map((file) => expandPath(file)))];
	}

	async getTaskInfo(taskName: string): Promise<MiseTaskInfo | undefined> {
		if (!this.getMiseBinaryPath()) {
			return undefined;
		}

		try {
			const { stdout } = await this.execMiseCommand([
				"tasks",
				"info",
				"--json",
				taskName,
			]);
			return parseTaskInfoJson(stdout);
		} catch (error: unknown) {
			logger.info(
				"Error fetching mise task info as json, falling back to text output:",
				error as Error,
			);
		}

		try {
			const { stdout } = await this.execMiseCommand([
				"tasks",
				"info",
				taskName,
			]);
			return parseTaskInfo(stdout);
		} catch (error: unknown) {
			logger.info("Error fetching mise task info:", error as Error);
			return undefined;
		}
	}

	async getCurrentTools({
		useCache = true,
		local = false,
		configRootPath = undefined,
	}: {
		useCache?: boolean;
		local?: boolean;
		/** Resolve tools from this directory instead of the workspace root (monorepo project) */
		configRootPath?: string;
	} = {}): Promise<Array<MiseTool>> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const cacheInstance = useCache ? this.cache : this.dedupeCache;
			const { stdout } = await cacheInstance.execCmd({
				args: [
					...(configRootPath ? ["-C", configRootPath] : []),
					"ls",
					local ? "--local" : "--current",
					"--offline",
					"--json",
				],
				// the tool decorations re-read this uncached on every change
				retainOnParseError: true,
			});

			return this.withLazyFlags(
				Object.entries(JSON.parse(stdout)).flatMap(([toolName, tools]) => {
					return (tools as MiseTool[]).map((tool) => {
						return {
							name: toolName,
							version: tool.version,
							requested_version: tool.requested_version,
							active: tool.active,
							installed: tool.installed,
							install_path: tool.install_path,
							source: tool.source,
						} satisfies MiseTool;
					});
				}),
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				if (await this.handleUntrustedFile()) {
					return this.getCurrentTools();
				}
				return [];
			}

			return [];
		}
	}

	/** the lockfile checks that failed, by command */
	private readonly lockfileCheckFailures = new Map<
		string,
		{ at: number; error: unknown }
	>();

	/** the descriptions of `mise registry --json`, see miseRegistryDescriptions */
	private registryDescriptions?: {
		at: number;
		descriptions: Promise<Map<string, string>>;
	};

	/** the last `mise outdated`, which a hover uses instead of running it */
	private recentOutdatedTools?: { tools: MiseToolUpdate[]; at: number };

	/**
	 * `[tools]` tables of the config files, re-read when a file changes. `null`
	 * for a file that does not parse.
	 */
	private readonly configToolsCache = new Map<
		string,
		{ stamp: string; tools: Promise<Record<string, unknown> | null> }
	>();

	private async readConfigTools(
		configPath: string,
	): Promise<Record<string, unknown> | null> {
		let stamp: string;
		try {
			const { mtimeMs, size } = await stat(configPath);
			stamp = `${mtimeMs}:${size}`;
		} catch {
			return null;
		}

		const cached = this.configToolsCache.get(configPath);
		if (cached?.stamp === stamp) {
			return cached.tools;
		}
		// the tools of one file are looked up together, read it once for all
		const tools = readFile(configPath, "utf8")
			.then(
				(source) =>
					(parse(source) as { tools?: Record<string, unknown> }).tools ?? {},
			)
			.catch((error) => {
				logger.debug(`Could not read the tools of ${configPath}: ${error}`);
				return null;
			});
		this.configToolsCache.set(configPath, { stamp, tools });
		return tools;
	}

	/**
	 * `mise ls` reports the tools declared with `lazy = true` as not installed
	 * until their first use, without saying they are lazy: their declaration
	 * tells. Only the tools that are not installed are looked up.
	 */
	private async withLazyFlags(tools: MiseTool[]): Promise<MiseTool[]> {
		return Promise.all(
			tools.map(async (tool) => {
				const configPath = tool.source?.path;
				if (tool.installed || !configPath?.endsWith(".toml")) {
					return tool;
				}

				const configTools = await this.readConfigTools(configPath);
				const lazy = configTools
					? isLazyToolDeclaration(
							findToolDeclaration(configTools, tool.name),
							tool.requested_version,
						)
					: // the parser does not read every file mise does (TOML 1.1), mise
						// knows whether the tool is lazy, not which of its versions
						(await this.miseToolInfo(tool.name).catch(() => undefined))
							?.tool_options.lazy === true;
				return lazy ? { ...tool, lazy } : tool;
			}),
		);
	}

	async getAllTools(): Promise<Array<MiseTool>> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
				args: ["ls", "--offline", "--json"],
				retainOnParseError: true,
			});
			return this.withLazyFlags(
				Object.entries(JSON.parse(stdout)).flatMap(([toolName, tools]) => {
					return (tools as MiseTool[]).map((tool) => {
						return {
							name: toolName,
							version: tool.version,
							requested_version: tool.requested_version,
							active: tool.active,
							installed: tool.installed,
							install_path: tool.install_path,
							source: tool.source,
						} satisfies MiseTool;
					});
				}),
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				if (await this.handleUntrustedFile()) {
					return this.getAllTools();
				}
				return [];
			}

			logger.info("Error fetching mise tools:", error as Error);
			return [];
		}
	}

	async getOutdatedTools({
		bump = false,
		// the last result when it is less than a minute old, e.g. for a hover
		allowStale = false,
	} = {}): Promise<Array<MiseToolUpdate>> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const recent = this.recentOutdatedTools;
		if (
			allowStale &&
			!bump &&
			recent &&
			Date.now() - recent.at < STALE_OUTDATED_TOOLS_MS
		) {
			return recent.tools;
		}

		// --bump is only requested explicitly (button click), so bypass the TTL
		// cache to make sure a new check is performed each time
		const { stdout } = bump
			? await this.dedupeCache.execCmd({
					args: ["outdated", "--bump", "--json"],
				})
			: await this.cache.execCmd({
					args: ["outdated", "--json"],
					retainOnParseError: true,
				});

		if (!stdout) {
			return [];
		}

		const tools = Object.entries(JSON.parse(stdout)).map(([toolName, tool]) => {
			const foundTool = tool as {
				name: string;
				requested: string;
				current: string;
				latest: string | null;
				bump: string | null;
				release_url?: string;
				source: { type: string; path: string };
			};

			return {
				name: toolName,
				version: foundTool.current,
				requested_version: foundTool.requested,
				source: foundTool.source,
				latest: foundTool.latest,
				bump: foundTool.bump,
				release_url: toWebUrl(foundTool.release_url),
			};
		});
		if (!bump) {
			this.recentOutdatedTools = { tools, at: Date.now() };
		}
		return tools;
	}

	async rmUseTool(filename: string, toolName: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		const cmd = ["use"];
		if (filename) {
			const normalizedPath = isWindows
				? filename.replace(/\\/g, "/").replace(/^\//, "")
				: filename;

			cmd.push("--path", normalizedPath);
		}
		cmd.push("--rm");
		cmd.push(toolName);
		await this.runMiseToolActionInConsole(cmd);
	}

	async removeToolInConsole(toolName: string, version?: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole([
			"uninstall",
			version ? `${toolName}@${version}` : toolName,
		]);
	}

	async getEnvs({
		useCache = true,
	}: {
		useCache?: boolean;
	} = {}): Promise<MiseEnv[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const cacheInstance = useCache ? this.cache : this.dedupeCache;
			const { stdout } = await cacheInstance.execCmd({
				args: ["env", "--json"],
				retainOnParseError: true,
			});
			return Object.entries(JSON.parse(stdout)).map(([key, value]) => ({
				name: key,
				value: value as string,
			}));
		} catch (error) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				if (await this.handleUntrustedFile()) {
					return this.getEnvs({ useCache });
				}
				return [];
			}

			logger.info("Error fetching mise environments:", error as Error);
			return [];
		}
	}

	async getEnvWithInfo({
		configRootPath = undefined,
	}: {
		/** Resolve envs from this directory instead of the workspace root (monorepo project) */
		configRootPath?: string;
	} = {}) {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.cache.execCmd({
			retainOnParseError: true,
			args: [
				...(configRootPath ? ["-C", configRootPath] : []),
				"env",
				"--json-extended",
			],
		});

		const parsed = JSON.parse(stdout) as Record<string, MiseEnvWithInfo>;
		const envs = Object.entries(parsed).map(([key, info]) => ({
			name: key,
			value: info.value ?? "",
			tool: info?.tool,
			source: info?.source ? expandPath(info.source) : undefined,
		}));
		for (const { source } of envs) {
			// the variables of `[env]` come from the config file itself
			if (source && !isMiseConfigPath(source)) {
				this.envFiles.add(source);
			}
		}
		return envs;
	}

	/** Absolute paths of the monorepo config roots, empty outside of a monorepo */
	async getMonorepoConfigRootPaths(): Promise<string[]> {
		// resolving project configs spawns one mise process per project
		if (!shouldResolveMonorepoProjectConfigs()) {
			return [];
		}

		const workspaceRoot = this.getCurrentWorkspaceFolderPath();
		if (!workspaceRoot) {
			return [];
		}

		const tasks = await this.getAllCachedTasks();
		return getConfigRootPaths(tasks).map((configRoot) =>
			expandPath(path.join(workspaceRoot, configRoot)),
		);
	}

	/**
	 * Root tools plus the ones defined by monorepo projects. Project tools are
	 * not visible from the workspace root, they require resolving with `-C`.
	 */
	async getCurrentToolsIncludingMonorepo(): Promise<Array<MiseTool>> {
		const [rootTools, configRootPaths] = await Promise.all([
			this.getCurrentTools(),
			this.getMonorepoConfigRootPaths(),
		]);

		if (!configRootPaths.length) {
			return rootTools;
		}

		const projectTools = await Promise.all(
			configRootPaths.map(async (configRootPath) => {
				const tools = await this.getCurrentTools({ configRootPath }).catch(
					() => [] as MiseTool[],
				);
				// the rest is already reported by the workspace root
				return tools.filter((tool) =>
					tool.source?.path
						? expandPath(tool.source.path).startsWith(configRootPath)
						: false,
				);
			}),
		);

		return uniqBy(
			[...rootTools, ...projectTools.flat()],
			(tool) =>
				`${tool.name}|${tool.requested_version}|${tool.source?.path ?? ""}`,
		);
	}

	/** Envs defined by each project, they only apply within the project directory */
	async getMonorepoProjectEnvs() {
		const configRootPaths = await this.getMonorepoConfigRootPaths();

		const projectEnvs = await Promise.all(
			configRootPaths.map(async (configRootPath) => {
				const envs = await this.getEnvWithInfo({ configRootPath }).catch(
					() => [] as MiseEnvWithInfo[],
				);
				return {
					configRootPath,
					envs: envs.filter((env) =>
						env.source ? env.source.startsWith(configRootPath) : false,
					),
				};
			}),
		);

		return projectEnvs.filter((project) => project.envs.length > 0);
	}

	/** Envs of the workspace root plus the ones defined by monorepo projects */
	async getEnvWithInfoIncludingMonorepo() {
		const [rootEnvs, projectEnvs] = await Promise.all([
			this.getEnvWithInfo(),
			this.getMonorepoProjectEnvs(),
		]);

		return uniqBy(
			[...rootEnvs, ...projectEnvs.flatMap((project) => project.envs)],
			(env) => `${env.name}|${env.value}|${env.source ?? ""}`,
		);
	}

	async miseFmt() {
		// `mise fmt` rewrites the config files without trusting them again
		const folder = this.getCurrentWorkspaceFolderPath();
		const ownEdits = folder ? await this.expectOwnEditsIn(folder) : [];
		try {
			await this.execMiseCommand(["fmt"], { setMiseEnv: false });
		} finally {
			await Promise.all(ownEdits.map((file) => this.trustOwnEdit(file)));
		}
	}

	/**
	 * Running anything against a config file that does not parse fails deep in
	 * mise, with a message about the task not existing rather than about the
	 * file. The views still list what was there before it broke, so this is easy
	 * to hit: say what is actually wrong, and offer the file.
	 *
	 * Returns false when the caller should not run.
	 */
	async confirmConfigParses(action: string): Promise<boolean> {
		if (!this.isServingRetainedState) {
			return true;
		}

		const openFile = "Open config file";
		const broken = [...this.unparsedConfigFiles];
		const selection = await vscode.window.showWarningMessage(
			`Cannot ${action}: a mise config file does not parse.`,
			...(broken.length ? [openFile] : []),
		);

		if (selection === openFile && broken[0]) {
			const document = await vscode.workspace.openTextDocument(
				vscode.Uri.file(broken[0]),
			);
			await vscode.window.showTextDocument(document);
		}
		return false;
	}

	/**
	 * `mise run [runFlags] <task> [args]`. Flags of `mise run` itself have to
	 * precede the task name, everything after it is passed to the task.
	 */
	async runTask(
		taskName: string,
		{ runFlags = [], args = [] }: { runFlags?: string[]; args?: string[] } = {},
	): Promise<void> {
		if (!(await this.confirmConfigParses(`run "${taskName}"`))) {
			return;
		}

		const terminal = this.getOrCreateTerminal(`run ${taskName}`);
		terminal.show();

		const command = this.createMiseCommand([
			"run",
			...runFlags,
			taskName,
			...args,
		]);
		ensureMiseCommand(command);
		await runInVscodeTerminal(terminal, command);
	}

	async supportsAffectedTasks(): Promise<boolean> {
		return this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_AFFECTED_TASKS);
	}

	/**
	 * The monorepo projects affected by the git changes since `base`, with
	 * every task `mise run --affected` would run in them. Nothing runs.
	 *
	 * Undefined when a config of the workspace is untrusted or ignored: outside
	 * paranoid mode, `mise run` trusts the config it reads. Throws when mise
	 * cannot select the projects, e.g. outside of a monorepo root.
	 */
	async getAffectedTasks(
		base?: string,
	): Promise<MiseAffectedSelection | undefined> {
		if (
			this._untrustedConfigFiles.length ||
			(await this.isWorkspaceConfigIgnored())
		) {
			return undefined;
		}

		const { stdout } = await this.execMiseCommand([
			"run",
			...buildAffectedRunFlags(base),
			"--affected-json",
			"*",
		]);
		return JSON.parse(stdout);
	}

	/**
	 * Problems of the task definitions, from `mise tasks validate`. Nothing
	 * runs. Undefined when mise cannot report them, e.g. on versions without
	 * the command or while a config file does not parse.
	 */
	async getTasksValidation(): Promise<MiseTaskValidation | undefined> {
		if (
			!this.getMiseBinaryPath() ||
			!(await this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_TASKS_VALIDATE))
		) {
			return undefined;
		}

		// exits 1 when it finds an error, the report is on stdout either way
		const { stdout, stderr } = await this.execMiseCommandMergeOutput([
			"tasks",
			"validate",
			"--json",
		]);
		try {
			return JSON.parse(stdout);
		} catch {
			logger.info(`Could not validate the tasks: ${stderr.trim()}`);
			return undefined;
		}
	}

	async supportsConfigExplain(): Promise<boolean> {
		return this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_CONFIG_EXPLAIN);
	}

	/**
	 * The keys a config file sets, whether mise reads them, and whether they
	 * are deprecated (`mise config explain`, see {@link supportsConfigExplain}).
	 * It reads the file as plain TOML, so it also works on a config mise
	 * refuses to load.
	 */
	async explainConfigFile(filePath: string): Promise<ConfigKeyExplanation[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		// not cached: a file saved twice in a row is explained twice
		const { stdout } = await this.dedupeCache.execCmd({
			args: ["config", "explain", "--json", "--file", filePath],
			setMiseEnv: false,
		});
		return JSON.parse(stdout) as ConfigKeyExplanation[];
	}

	async supportsProjectChecks(): Promise<boolean> {
		return this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_PROJECT_CHECKS);
	}

	/**
	 * Runs the commands of the `[doctor.checks.<name>]` of the project, with its
	 * tools and env (`mise doctor project`). Throws when mise cannot run them,
	 * e.g. when a config file is not trusted.
	 */
	async runProjectChecks(): Promise<MiseProjectChecksReport> {
		// exits 1 when a check fails, the report is on stdout either way
		const { stdout, stderr } = await this.execMiseCommandMergeOutput([
			"doctor",
			"project",
			"--json",
		]);
		try {
			return JSON.parse(stdout);
		} catch {
			throw new Error(stderr.trim() || "mise doctor project did not report");
		}
	}

	async watchTask(taskName: string, ...args: string[]): Promise<void> {
		if (!(await this.confirmConfigParses(`watch "${taskName}"`))) {
			return;
		}

		const terminalName = `watch ${taskName}`;
		const previousTerminal = this.terminals.get(terminalName);
		if (previousTerminal) {
			previousTerminal.dispose();
			this.terminals.delete(terminalName);
		}
		const terminal = this.getOrCreateTerminal(terminalName);
		terminal.show();
		const command = this.createMiseCommand(["watch", taskName, ...args]);
		ensureMiseCommand(command);
		await runInVscodeTerminal(terminal, command);
	}

	private getOrCreateTerminal(name: string): vscode.Terminal {
		let terminal = this.terminals.get(name);
		if (!terminal || isTerminalClosed(terminal)) {
			terminal = vscode.window.createTerminal({
				name,
				cwd: this.getCurrentWorkspaceFolderPath(),
			});

			vscode.window.onDidCloseTerminal((closedTerminal) => {
				if (closedTerminal === terminal) {
					terminal = undefined;
					this.terminals.delete(name);
				}
			});
		}
		this.terminals.set(name, terminal);
		return terminal;
	}

	async binPaths(name: string) {
		const { stdout } = await this.cache.execCmd({
			args: ["bin-paths", name],
		});
		return stdout.trim().split("\n");
	}

	async which(name: string): Promise<string | undefined> {
		try {
			const { stdout } = await this.cache.execCmd({ args: ["which", name] });

			const out = stdout.trim();
			if (out === "") {
				return undefined;
			}

			return out;
		} catch (e) {
			if (!(e as Error)?.message?.includes("it is not currently active")) {
				logger.info(`Error running which ${name}`, e);
			}
			return undefined;
		}
	}

	async getAllBinsForTool(toolName: string) {
		const binDirs = await this.binPaths(toolName);
		return (
			await Promise.all(
				binDirs.map(async (binDir) => {
					try {
						const files = await vscode.workspace.fs.readDirectory(
							vscode.Uri.file(binDir),
						);
						return files.map(([name]) => path.join(binDir, name));
					} catch (e) {
						logger.info(`Error reading bin path: ${binDir}`, e as Error);
						return [];
					}
				}),
			)
		).flat();
	}

	async miseVersion() {
		const { stdout } = await this.cache.execCmd({
			args: ["version", "--json"],
		});

		const version = JSON.parse(stdout) as MiseVersion;
		// "version": "2025.3.2 windows-x64 (2025-03-07)",
		const current = version.version.split(" ")[0] ?? "";
		return {
			raw: version,
			latest: version.latest,
			current: current,
			newVersionAvailable: isNewerMiseVersion(version.latest, current),
		};
	}

	async getMiseConfiguration(): Promise<MiseConfig> {
		const { stdout, stderr } = await this.execMiseCommandMergeOutput(
			["doctor", "--json"],
			{ setMiseEnv: false },
		);
		if (stderr) {
			logger.debug("mise doctor --json", stderr);
		}

		// mise answers nothing when it cannot read the config, e.g. an untrusted
		// one: the views already report that, it is not an error of its own
		if (!stdout.trim()) {
			logger.info("mise doctor --json returned nothing", stderr);
			return {} as MiseConfig;
		}

		try {
			const miseConfig = JSON.parse(stdout) as MiseConfig;
			return expandConfig(miseConfig);
		} catch (error) {
			logger.error(`Error parsing mise configuration: ${stdout}`, error);
			return {} as MiseConfig;
		}
	}

	async miseDoctor() {
		const { stdout, stderr } = await this.execMiseCommandMergeOutput(
			["doctor"],
			{ setMiseEnv: false },
		);
		return `${stdout}\n${stderr}`;
	}

	async getMiseConfigFiles({
		configRootPath = undefined,
	}: {
		/** List the configs of this directory instead of the workspace root (monorepo project) */
		configRootPath?: string;
	} = {}) {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.cache.execCmd({
			args: [
				...(configRootPath ? ["-C", configRootPath] : []),
				"config",
				"ls",
				"--json",
			],
			retainOnParseError: true,
		});
		return JSON.parse(stdout) as Array<{
			path: string;
			tools: string[];
		}>;
	}

	async getMiseTomlConfigFilePathsEvenIfMissing() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const configFiles = new Set<string>();
		configFiles.add(
			expandPath(
				path.join(this.getCurrentWorkspaceFolderPath() || "", "mise.toml"),
			),
		);
		configFiles.add(
			expandPath(path.join(os.homedir(), ".config", "mise", "config.toml")),
		);

		const miseConfigs = (await this.getMiseConfigFiles())
			.map((file) => expandPath(file.path))
			.filter((path) => path.endsWith(".toml"));

		for (const file of miseConfigs) {
			configFiles.add(expandPath(file));
		}

		return Array.from(configFiles);
	}

	async miseReshim() {
		await this.execMiseCommand(["reshim"], { setMiseEnv: false }).catch(
			(error) => {
				logger.info("mise reshim", error as Error);
			},
		);
	}

	async getVersion() {
		if (!this.getMiseBinaryPath()) {
			return "";
		}

		const { stdout, stderr } = await this.execMiseCommandMergeOutput(
			["version"],
			{ setMiseEnv: false },
		);
		if (stderr) {
			if (stderr.includes("run mise self-update")) {
				logger.debug(`Mise version stderr: ${stderr.trim()}`);
			} else {
				logger.info(`Mise version stderr: ${stderr.trim()}`);
			}
		}
		return stdout.trim();
	}

	async getParsedMiseVersion() {
		return parseMiseVersion(await this.getVersion());
	}

	// Checks whether the mise binary can self-update.
	async canSelfUpdate() {
		if (!this.getMiseBinaryPath()) {
			return false;
		}

		const miseConfig = await this.getMiseConfiguration();
		if (miseConfig.self_update_available != null) {
			logger.debug(
				"self_update_available value from mise dr:",
				miseConfig.self_update_available,
			);
			return miseConfig.self_update_available;
		}

		const isSelfUpdateDisabled = await this.isSelfUpdateDisabled();
		return !isSelfUpdateDisabled;
	}

	// Checks for the presence of the `.disable-self-update` sentinel file in the Mise lib
	// dir, to determine if self-update is disabled (ie installed using a package manager).
	// It's a re-implementation of the `is_available()` function from `SelfUpdate`.
	// https://github.com/jdx/mise/blob/863505d4089126780c2352fb1218c6550c3cf9d8/src/cli/self_update.rs#L100
	async isSelfUpdateDisabled(): Promise<boolean> {
		logger.info("Checking if self-update is disabled...");

		try {
			const miseBinPath = this.getMiseBinaryPath();
			logger.info(`miseBinPath: ${miseBinPath}`);
			if (!miseBinPath) {
				return false; // Default to allowing self-update if we can't determine the path
			}

			// Get canonical path of the mise binary
			const canonicalPath = await realpath(miseBinPath);

			// Get parent directory, then parent of that (two levels up)
			const parentDir = path.dirname(canonicalPath);
			const grandParentDir = path.dirname(parentDir);

			// Check for sentinel files that disable self-update
			const disablePaths = [
				path.join(grandParentDir, "lib", ".disable-self-update"), // kept for compatibility
				path.join(grandParentDir, "lib", "mise", ".disable-self-update"),
			];

			for (const disablePath of disablePaths) {
				if (existsSync(disablePath)) {
					logger.info(`Self-update disabled by sentinel file: ${disablePath}`);
					return true;
				}
			}

			return false;
		} catch (error) {
			// If filesystem operations fail, fall back to allowing self-update
			logger.debug(`Failed to check for self-update disable files: ${error}`);
			return false;
		}
	}

	/** The user asked mise not to tell about new releases */
	private async isMiseUpdateWarningDisabled(): Promise<boolean> {
		const value = await this.getSetting("disable_update_warning").catch(
			() => undefined,
		);
		return value?.trim() === "true";
	}

	/** mise updates itself before the next eligible command run in a terminal */
	private async isMiseAutoUpdateEnabled(): Promise<boolean> {
		const value = await this.getSetting("self_update.auto").catch(
			() => undefined,
		);
		return isMiseAutoUpdateOn(value);
	}

	async hasValidMiseVersion(minVersion?: readonly [number, number, number]) {
		if (!this.getMiseBinaryPath()) {
			return false;
		}

		const version = await this.getParsedMiseVersion();
		if (!version) {
			return false;
		}

		return isVersionGreaterOrEqualThan(version, minVersion ?? MIN_MISE_VERSION);
	}

	async checkNewMiseVersion() {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		if (!shouldCheckForNewMiseVersion()) {
			return;
		}

		const miseVersion = await this.miseVersion();
		if (miseVersion.newVersionAvailable) {
			const ignoreVersion = this.context.globalState.get<string>(
				"mise.ignoreNewVersion",
			);

			if (ignoreVersion === miseVersion.latest) {
				return;
			}

			if (await this.isMiseUpdateWarningDisabled()) {
				logger.debug(
					"Not notifying of new mise version: disable_update_warning",
				);
				return;
			}

			const canSelfUpdate = await this.canSelfUpdate();

			if (canSelfUpdate && (await this.isMiseAutoUpdateEnabled())) {
				logger.debug("Not notifying of new mise version: self_update.auto");
				return;
			}

			const suggestion = await vscode.window.showInformationMessage(
				`New Mise version available ${miseVersion.latest}. (Current: ${miseVersion.current})`,
				canSelfUpdate ? "Update Mise" : "How to update Mise",
				"Show changelog",
				"Ignore this update",
			);

			if (suggestion === "How to update Mise") {
				await vscode.env.openExternal(
					vscode.Uri.parse("https://mise.jdx.dev/cli/self-update.html"),
				);
			}

			if (suggestion === "Update Mise") {
				await this.runMiseToolActionInConsole(["self-update", "-y"]);
			}

			if (suggestion === "Show changelog") {
				await vscode.env.openExternal(
					vscode.Uri.parse(
						"https://github.com/jdx/mise/blob/HEAD/CHANGELOG.md",
					),
				);
				await this.checkNewMiseVersion();
			}

			if (suggestion === "Ignore this update") {
				this.context.globalState.update(
					"mise.ignoreNewVersion",
					miseVersion.latest,
				);
			}
		}
	}

	async miseToolInfo(toolName: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}
		const { stdout } = await this.longTTLCache.execCmd({
			args: ["tool", toolName, "--json"],
		});
		return JSON.parse(stdout) as MiseToolInfo;
	}

	async miseRegistry() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.longTTLCache.execCmd({
			args: ["registry"],
			setMiseEnv: false,
		});

		return (
			stdout
				.trim()
				.split("\n")
				.map((line) => {
					const [short = "", ...backends] = line.trim().split(/\s+/);
					return { short, full: backends[0], backends };
				})
				// backends are always `backend:tool` strings; this also drops a
				// potential header line
				.filter((entry) => entry.short && entry.full?.includes(":"))
				.filter(
					(entry, index, self) =>
						self.findIndex((e) => e.short === entry.short) === index,
				)
		);
	}

	/**
	 * The description of each registry tool. Empty when mise cannot list them.
	 * Slower than `miseRegistry`, which does not have them.
	 */
	async miseRegistryDescriptions(): Promise<Map<string, string>> {
		if (!this.getMiseBinaryPath()) {
			return new Map();
		}

		// kept, a failure included: completions ask for it item by item
		const cached = this.registryDescriptions;
		if (cached && Date.now() - cached.at < REGISTRY_DESCRIPTIONS_TTL_MS) {
			return cached.descriptions;
		}
		const descriptions = this.readRegistryDescriptions();
		this.registryDescriptions = { at: Date.now(), descriptions };
		return descriptions;
	}

	private async readRegistryDescriptions(): Promise<Map<string, string>> {
		if (!(await this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_REGISTRY_JSON))) {
			return new Map();
		}

		try {
			const { stdout } = await this.execMiseCommand(["registry", "--json"], {
				setMiseEnv: false,
			});
			const entries = JSON.parse(stdout) as {
				short: string;
				description?: string | null;
			}[];
			return new Map(
				entries.flatMap((entry) =>
					entry.description ? [[entry.short, entry.description]] : [],
				),
			);
		} catch (error) {
			logger.debug("Could not read the registry descriptions", error);
			return new Map();
		}
	}

	async supportsLockfileLenses(): Promise<boolean> {
		return this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_LOCKFILE_LENSES);
	}

	/**
	 * What `mise lock` would change in the lockfiles of a config root, the
	 * local one included: the tools added to or removed from the config, and
	 * the requests changed since. With `bump`, what `mise lock --bump` would
	 * change: the newer versions the requests allow, which mise looks up
	 * online. Nothing is written. Empty when lockfiles are off.
	 */
	async getLockfileChanges(
		configRoot: string,
		{ bump = false } = {},
	): Promise<LockfileChange[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const args = [
			"-C",
			configRoot,
			"lock",
			"--dry-run",
			"--json",
			...(bump ? ["--bump"] : []),
		];
		const key = args.join(" ");
		const failure = this.lockfileCheckFailures.get(key);
		if (failure && Date.now() - failure.at < LOCKFILE_CHECK_RETRY_MS) {
			throw failure.error;
		}

		try {
			// a bump looks up the remote versions: kept for a minute
			const { stdout } = await (bump ? this.slowCache : this.cache).execCmd({
				args,
				retainOnParseError: true,
			});
			return JSON.parse(stdout) as LockfileChange[];
		} catch (error) {
			// e.g. offline, or a private repository: not looked up again on every
			// refresh of the lenses. A config being typed parses again soon.
			if (!isMiseConfigParseError(error)) {
				this.lockfileCheckFailures.set(key, { at: Date.now(), error });
			}
			throw error;
		}
	}

	/**
	 * The `lockfile` setting of a config root: `true` creates its lockfile,
	 * `false` turns lockfiles off, unset (undefined) only updates an existing
	 * one
	 */
	async getLockfileSetting(configRoot: string): Promise<boolean | undefined> {
		if (!this.getMiseBinaryPath()) {
			return undefined;
		}

		try {
			const { stdout } = await this.cache.execCmd({
				args: ["-C", configRoot, "settings", "get", "lockfile"],
				retainOnParseError: true,
			});
			return stdout.trim() === "true";
		} catch {
			// mise fails to get a setting that is not set
			return undefined;
		}
	}

	async supportsPackageRegistrySearch(): Promise<boolean> {
		return this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_PACKAGE_SEARCH);
	}

	/**
	 * The tools matching `query` (`mise search`). With a package registry
	 * prefix such as `npm:`, the packages of that registry.
	 */
	async searchTools(query: string): Promise<ToolSearchResult[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.longTTLCache.execCmd({
				args: ["search", query, "--no-header"],
				setMiseEnv: false,
			});
			return parseToolSearchResults(stdout);
		} catch (error) {
			// exits 1 when nothing matches
			if (
				error instanceof Error &&
				error.message.includes("not found in registry")
			) {
				return [];
			}
			throw error;
		}
	}

	async miseBackends() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		const { stdout } = await this.longTTLCache.execCmd({
			args: ["backends"],
			setMiseEnv: false,
		});

		return stdout.trim().split("\n");
	}

	async listRemoteVersions(
		toolName: string,
		{ yes = false } = {},
	): Promise<string[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.longTTLCache.execCmd({
				args: ["ls-remote", toolName, ...(yes ? ["--yes"] : [])],
				setMiseEnv: false,
			});
			if (yes) {
				return this.listRemoteVersions(toolName);
			}
			// no version: `"".split("\n")` is `[""]`
			return stdout.trim().split("\n").filter(Boolean).reverse();
		} catch (error) {
			if (
				error instanceof Error &&
				error?.message?.includes("community-developed plugin")
			) {
				const selection = await vscode.window.showQuickPick(["Yes", "No"], {
					title: `${toolName} is a community-developed plugin. Do you trust it?`,
					placeHolder: "Yes",
				});
				if (selection === "Yes") {
					return this.listRemoteVersions(toolName, { yes: true });
				}
			}
			logger.info("Error fetching remote versions:", error as Error);
			throw error;
		}
	}

	async hasMissingTools() {
		if (!this.getMiseBinaryPath()) {
			return false;
		}

		const tools = await this.getCurrentTools();
		return getMissingTools(tools).length > 0;
	}

	async miseSetEnv({
		filePath,
		name,
		value,
	}: {
		filePath: string;
		name: string;
		value: string;
	}) {
		await this.execMiseCommand(
			["set", "--file", filePath, `${name}=${value}`],
			{ setMiseEnv: false },
		);
	}
	async getSetting(key: string): Promise<string | undefined> {
		if (!this.getMiseBinaryPath()) {
			return undefined;
		}

		const { stdout } = await this.cache.execCmd({
			args: ["settings", "get", "--quiet", "--silent", key],
			setMiseEnv: undefined,
		});
		return stdout;
	}

	async getSettings() {
		if (!this.getMiseBinaryPath()) {
			return {};
		}

		const { stdout } = await this.execMiseCommand([
			"settings",
			"--all",
			"--json-extended",
		]);
		return flattenSettings(JSON.parse(stdout));
	}

	async getSettingsSchema() {
		return this.longTTLCache.fetchSchema();
	}

	private async parseConfigFileTools(
		configPath: string,
	): Promise<{ path: string; tools: Record<string, unknown> } | undefined> {
		try {
			const stats = await vscode.workspace.fs.stat(vscode.Uri.file(configPath));
			if (stats.type !== vscode.FileType.File) {
				return undefined;
			}

			const content = await vscode.workspace.fs.readFile(
				vscode.Uri.file(configPath),
			);
			if (configPath.endsWith(".toml")) {
				const config = parse(content.toString());
				return { path: configPath, tools: config.tools ?? {} };
			}
			if (isToolVersionsFile(configPath)) {
				return {
					path: configPath,
					tools: parseToolVersionsContent(content.toString()),
				};
			}
			const idiomaticFile = [...idiomaticFiles].find((ext) =>
				configPath.endsWith(ext),
			);
			if (idiomaticFile) {
				return {
					path: configPath,
					tools: {
						// @ts-expect-error
						[idiomaticFileToTool[idiomaticFile]]: content.toString().trim(),
					},
				};
			}
			return { path: configPath, tools: {} };
		} catch {
			return undefined;
		}
	}

	async getTrackedConfigFiles() {
		const trackedConfigFiles = await vscode.workspace.fs.readDirectory(
			vscode.Uri.file(TRACKED_CONFIG_DIR),
		);

		const parsedTrackedConfigs = await Promise.all(
			trackedConfigFiles.map(async ([n]) => {
				const trackedConfigPath = await readlink(
					path.join(TRACKED_CONFIG_DIR, n),
				).catch(() => "");
				if (!trackedConfigPath) {
					return undefined;
				}
				return this.parseConfigFileTools(trackedConfigPath);
			}),
		);

		const validConfigs = parsedTrackedConfigs.filter(
			(trackedConfig) => trackedConfig !== undefined,
		);

		return uniqBy(validConfigs, (c) => c.path).sort((a, b) =>
			a.path.localeCompare(b.path),
		);
	}

	async getProjects(): Promise<MiseProjectsData> {
		return this.projectsCache.getProjects();
	}

	getProjectScanDirectories(): string[] {
		return this.context.globalState.get<string[]>(
			PROJECT_SCAN_DIRECTORIES_KEY,
			[],
		);
	}

	async addProjectScanDirectory(dir: string) {
		const dirs = this.getProjectScanDirectories();
		if (!dirs.includes(dir)) {
			await this.context.globalState.update(PROJECT_SCAN_DIRECTORIES_KEY, [
				...dirs,
				dir,
			]);
		}
		await this.projectsCache.clear();
	}

	async removeProjectScanDirectory(dir: string) {
		await this.context.globalState.update(
			PROJECT_SCAN_DIRECTORIES_KEY,
			this.getProjectScanDirectories().filter((d) => d !== dir),
		);
		await this.projectsCache.clear();
	}

	/**
	 * Tool requests grouped by config file across the whole machine, from
	 * `mise ls --all-sources` (2026+). Empty on older mise versions; the
	 * caller falls back to the parsed tracked configs.
	 */
	private async getConfigsFromAllSources() {
		if (!this.getMiseBinaryPath()) {
			return [];
		}
		try {
			const { stdout } = await this.longTTLCache.execCmd({
				args: ["ls", "--all-sources", "--json"],
				setMiseEnv: false,
			});
			return configsFromLsAllSources(
				JSON.parse(stdout) as MiseLsAllSourcesOutput,
			);
		} catch (error) {
			logger.info("mise ls --all-sources is not available", error);
			return [];
		}
	}

	private async loadProjectEntries(): Promise<MiseProjectsData> {
		const [trackedConfigs, allSourcesConfigs] = await Promise.all([
			// still needed even when `mise ls --all-sources` works: it only
			// reports tools, so task-only configs would be missed
			this.getTrackedConfigFiles().catch(
				() => [] as Array<{ path: string; tools: Record<string, unknown> }>,
			),
			this.getConfigsFromAllSources(),
		]);

		const scanDirs = this.getProjectScanDirectories().map((dir) =>
			expandPath(dir),
		);
		const scannedPaths = (
			await Promise.all(
				scanDirs.map((dir) => findMiseConfigsInDir(dir).catch(() => [])),
			)
		).flat();

		const configsByPath = new Map(
			trackedConfigs.map((config) => [config.path, config]),
		);
		// mise's own resolution wins over our parsed values, tool by tool
		for (const config of allSourcesConfigs) {
			configsByPath.set(config.path, {
				path: config.path,
				tools: { ...configsByPath.get(config.path)?.tools, ...config.tools },
			});
		}

		const scannedConfigs = await Promise.all(
			scannedPaths
				.filter((configPath) => !configsByPath.has(configPath))
				.map((configPath) => this.parseConfigFileTools(configPath)),
		);
		for (const config of scannedConfigs) {
			if (config && !configsByPath.has(config.path)) {
				configsByPath.set(config.path, config);
			}
		}

		const globalConfigFile = process.env.MISE_GLOBAL_CONFIG_FILE;
		return {
			...buildProjectsData([...configsByPath.values()], {
				globalConfigPaths: globalConfigFile ? [globalConfigFile] : [],
			}),
			scanDirectories: this.getProjectScanDirectories(),
		};
	}

	dispose() {
		for (const terminal of this.terminals.values()) {
			if (terminal) {
				terminal.dispose?.();
			}
		}
	}

	async pruneToolsInConsole() {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		const selection = await vscode.window.showWarningMessage(
			"Are you sure you want to prune unused tools?",
			{ modal: true },
			"Yes",
			"dry run",
		);

		if (!selection) {
			return;
		}

		return selection === "Yes"
			? this.runMiseToolActionInConsole(["prune"])
			: this.runMiseToolActionInConsole(["prune", "--dry-run"]);
	}

	async upgradeToolInConsole(toolName: string, { bump = false } = {}) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		const args = ["up"];
		if (bump) {
			args.push("--bump");
		}
		if (
			shouldKeepReplacedVersionOnUpgrade() &&
			(await this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_UPGRADE_NO_PRUNE))
		) {
			args.push("--no-prune");
		}
		args.push(toolName);

		await this.runMiseToolActionInConsole(args);
	}

	async installToolInConsole(toolName: string, version: string) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole([
			"install",
			`${toolName}@${version}`,
		]);
	}

	async editSetting(
		setting: string,
		{ value, filePath }: { value: string; filePath: string },
	) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		// `mise config set` rewrites the file without trusting it again
		await this.expectOwnEdit(filePath);
		try {
			await this.runMiseToolActionInConsole([
				"config",
				"set",
				`settings.${setting}`,
				value,
				"--file",
				filePath,
			]);
		} finally {
			await this.trustOwnEdit(filePath);
		}
	}

	async createMiseToolSymlink(
		binName: string,
		binPath: string,
		targetType: "dir" | "file" = "dir",
	) {
		const symLinksFolder = getConfiguredSymLinksFolder();
		const toolsPaths = path.isAbsolute(symLinksFolder)
			? symLinksFolder
			: path.join(this.getCurrentWorkspaceFolderPath() ?? "", symLinksFolder);

		const sanitizedBinName = binName.replace(/[^a-zA-Z0-9.-]/g, "_");

		await mkdirp(toolsPaths);
		const linkPath = path.join(toolsPaths, sanitizedBinName);
		const configuredPath = path.isAbsolute(symLinksFolder)
			? linkPath
			: path.join(
					// biome-ignore lint/suspicious/noTemplateCurlyInString: expected
					"${workspaceFolder}",
					symLinksFolder,
					sanitizedBinName,
				);

		if (existsSync(linkPath)) {
			logger.debug(
				`Checking symlink for ${binName}: ${await readlink(linkPath)}: ${binPath}`,
			);
			if ((await readlink(linkPath)) === binPath) {
				return configuredPath;
			}

			logger.info(
				`${linkPath} was symlinked to a different version. Deleting the old symlink now.`,
			);
			await rm(linkPath);
		}

		await symlink(binPath, linkPath, targetType).catch((err) => {
			if (err.code === "EEXIST") {
				logger.info(`Symlink already exists for ${binPath}`);
				return;
			}

			throw err;
		});
		logger.info(`New symlink created ${linkPath} -> ${binPath}`);
		return configuredPath;
	}

	/**
	 * Project graph inferred from ecosystem manifests. Empty outside of a
	 * workspace or when mise does not support `tasks graph` yet.
	 */
	async getTasksGraph(): Promise<MiseProject[]> {
		if (!this.getMiseBinaryPath()) {
			return [];
		}

		try {
			const { stdout } = await this.cache.execCmd({
				args: ["tasks", "graph", "--json"],
			});
			return (JSON.parse(stdout).projects ?? []) as MiseProject[];
		} catch (error) {
			logger.debug("mise tasks graph is not available:", error as Error);
			return [];
		}
	}

	async isBootstrapAvailable() {
		return this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_BOOTSTRAP);
	}

	/**
	 * Aggregate status of `[bootstrap.*]`, `[dotfiles]` and `[tools]` sections.
	 * `undefined` when the installed mise version does not support bootstrap.
	 */
	async getBootstrapStatus(): Promise<MiseBootstrapStatus | undefined> {
		if (!this.getMiseBinaryPath()) {
			return undefined;
		}

		if (!(await this.isBootstrapAvailable())) {
			return undefined;
		}

		try {
			const { stdout } = await this.bootstrapCache.execCmd({
				args: ["bootstrap", "status", "--json"],
				retainOnParseError: true,
			});
			return JSON.parse(stdout) as MiseBootstrapStatus;
		} catch (error) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				if (await this.handleUntrustedFile()) {
					return this.getBootstrapStatus();
				}
				return undefined;
			}

			throw error;
		}
	}

	async runBootstrapInConsole({ dryRun = false } = {}) {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole(
			dryRun ? ["bootstrap", "--dry-run"] : ["bootstrap", "--yes"],
		);
	}

	async isBootstrapPlanAvailable() {
		return this.hasValidMiseVersion(MIN_MISE_VERSION_FOR_BOOTSTRAP_PLAN);
	}

	/**
	 * The changes the declarative `[bootstrap.*]` resources would make, without
	 * applying anything. `undefined` when the installed mise version predates
	 * `mise bootstrap plan`.
	 */
	async getBootstrapPlan(): Promise<MiseBootstrapPlan | undefined> {
		if (!this.getMiseBinaryPath()) {
			return undefined;
		}

		if (!(await this.isBootstrapPlanAvailable())) {
			return undefined;
		}

		try {
			const { stdout } = await this.bootstrapCache.execCmd({
				args: ["bootstrap", "plan", "--json"],
			});
			return JSON.parse(stdout) as MiseBootstrapPlan;
		} catch (error) {
			if (error instanceof Error && error.message.includes("mise trust")) {
				if (await this.handleUntrustedFile()) {
					return this.getBootstrapPlan();
				}
				return undefined;
			}

			throw error;
		}
	}

	async runBootstrapPlanInConsole() {
		if (!this.getMiseBinaryPath()) {
			return;
		}

		await this.runMiseToolActionInConsole(["bootstrap", "plan"]);
	}
}
