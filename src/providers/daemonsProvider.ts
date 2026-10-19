import { existsSync } from "node:fs";
import * as vscode from "vscode";
import {
	MISE_OPEN_DAEMON_DEFINITION,
	MISE_OPEN_DAEMON_URL,
	MISE_OPEN_PITCHFORK_TUI,
	MISE_OPEN_PITCHFORK_WEB_UI,
	MISE_RESET_DAEMON_DATA,
	MISE_RESTART_DAEMON,
	MISE_RESTART_DAEMON_GROUP,
	MISE_REVEAL_DAEMON_DATA,
	MISE_SHOW_DAEMON_LOGS,
	MISE_START_ALL_DAEMONS,
	MISE_START_DAEMON,
	MISE_START_DAEMON_GROUP,
	MISE_STOP_ALL_DAEMONS,
	MISE_STOP_DAEMON,
	MISE_STOP_DAEMON_GROUP,
} from "../commands";
import { isMiseExtensionEnabled } from "../configuration";
import type {
	DaemonAction,
	DaemonsService,
	DaemonsState,
} from "../daemonsService";
import { findKeyInTomlDocument } from "../utils/bootstrapDocument";
import {
	type Daemon,
	type DaemonGroup,
	describeDaemon,
	GLOBAL_NAMESPACE,
	groupDaemons,
	isDaemonActive,
	isDaemonFailed,
	MIN_PITCHFORK_VERSION,
	pitchforkConfigCandidates,
} from "../utils/daemons";
import { expandPath } from "../utils/fileUtils";
import { logger } from "../utils/logger";
import { markdownCodeSpan } from "../utils/markdown";

export const DAEMONS_VIEW_ID = "miseDaemonsView";

/** How often the view asks for the status of the daemons while it is visible */
const POLL_INTERVAL_MS = 5_000;
/** and while it is hidden, as long as a daemon runs */
const HIDDEN_POLL_INTERVAL_MS = 15_000;

export const PENDING_LABELS: Record<DaemonAction, string> = {
	start: "starting…",
	stop: "stopping…",
	restart: "restarting…",
};

type TreeItem =
	| DaemonItem
	| GroupsItem
	| GroupItem
	| GlobalDaemonsItem
	| MessageItem;

function daemonIcon(daemon: Daemon, pending: boolean): vscode.ThemeIcon {
	if (
		pending ||
		["waiting", "stopping", "restarting"].includes(daemon.status)
	) {
		return new vscode.ThemeIcon("loading~spin");
	}
	if (daemon.disabled) {
		return new vscode.ThemeIcon("circle-slash");
	}
	if (daemon.status === "running") {
		return new vscode.ThemeIcon(
			"pass-filled",
			new vscode.ThemeColor("testing.iconPassed"),
		);
	}
	if (isDaemonFailed(daemon)) {
		return new vscode.ThemeIcon(
			"error",
			new vscode.ThemeColor("testing.iconFailed"),
		);
	}
	return new vscode.ThemeIcon("circle-large-outline");
}

export function daemonTooltip(daemon: Daemon): vscode.MarkdownString {
	const lines = [`**${daemon.name}** ${markdownCodeSpan(daemon.id)}`, ""];
	lines.push(`Status: ${daemon.disabled ? "disabled" : daemon.status}`);
	if (daemon.error) {
		lines.push(`Error: ${daemon.error}`);
	}
	if (daemon.pid) {
		lines.push(`PID: ${daemon.pid}`);
	}
	if (daemon.port !== undefined) {
		lines.push(`Port: ${daemon.port}`);
	}
	if (daemon.url) {
		lines.push(`URL: ${daemon.url}`);
	}
	if (daemon.preset) {
		lines.push(`Preset: ${markdownCodeSpan(daemon.preset)}`);
	}
	if (daemon.run) {
		lines.push(`Runs: ${markdownCodeSpan(daemon.run)}`);
	}
	if (daemon.dataDir) {
		lines.push(`Data: ${markdownCodeSpan(daemon.dataDir)}`);
	}
	lines.push(
		daemon.kind === "mise"
			? `Declared in ${daemon.source ? markdownCodeSpan(daemon.source) : "a mise config"}`
			: "Declared in a pitchfork config",
	);
	// a blank line between the lines, which markdown would join
	return new vscode.MarkdownString(lines.join("\n\n"));
}

export class DaemonItem extends vscode.TreeItem {
	constructor(
		public readonly daemon: Daemon,
		pending: string | undefined,
		/** a daemon also listed under a group gets an id of its own there */
		idPrefix = "",
	) {
		super(daemon.name, vscode.TreeItemCollapsibleState.None);
		this.id = `${idPrefix}${daemon.id}`;
		this.description = pending ?? describeDaemon(daemon);
		this.tooltip = daemonTooltip(daemon);
		this.iconPath = daemonIcon(daemon, !!pending);
		// e.g. `miseDaemon;active;url`, matched with `viewItem =~ /;active/`
		this.contextValue = [
			"miseDaemon",
			isDaemonActive(daemon) ? "active" : "inactive",
			...(daemon.url ? ["url"] : []),
			// mise reports it before the preset first starts
			...(daemon.dataDir && existsSync(daemon.dataDir) ? ["data"] : []),
		].join(";");
		this.command = {
			command: MISE_OPEN_DAEMON_DEFINITION,
			title: "Open Definition",
			arguments: [daemon],
		};
	}
}

const groupKey = (group: DaemonGroup) => `${group.kind}:${group.name}`;

class GroupsItem extends vscode.TreeItem {
	constructor(public readonly groups: GroupItem[]) {
		super("Groups", vscode.TreeItemCollapsibleState.Collapsed);
		this.id = "miseDaemons:groups";
		this.description = `(${groups.length})`;
		this.tooltip =
			"The groups of daemons of the project: `[daemon_groups]` in mise, `[groups]` in pitchfork";
		this.iconPath = new vscode.ThemeIcon("layers");
	}
}

export class GroupItem extends vscode.TreeItem {
	constructor(
		public readonly group: DaemonGroup,
		public readonly daemons: DaemonItem[],
		pending: string | undefined,
	) {
		super(group.name, vscode.TreeItemCollapsibleState.Collapsed);
		this.id = `miseDaemons:group:${groupKey(group)}`;
		const active = daemons.filter((item) => isDaemonActive(item.daemon));
		this.description =
			pending ??
			[
				`${active.length}/${daemons.length} running`,
				...(group.kind === "mise" && group.name === "default"
					? ["started by default"]
					: []),
			].join(" · ");
		this.tooltip = new vscode.MarkdownString(
			[
				`**${group.name}** ${group.kind === "mise" ? "mise" : "pitchfork"} group`,
				`Members: ${group.members.map((member) => markdownCodeSpan(member)).join(", ")}`,
				`Declared in ${group.sources.map((source) => markdownCodeSpan(source)).join(", ")}`,
			].join("\n\n"),
		);
		this.iconPath = new vscode.ThemeIcon(pending ? "loading~spin" : "layers");
		// e.g. `miseDaemonGroup;someActive`, see the menus of package.json
		this.contextValue = [
			"miseDaemonGroup",
			...(active.length ? ["someActive"] : []),
			...(active.length < daemons.length ? ["someInactive"] : []),
		].join(";");
	}
}

class GlobalDaemonsItem extends vscode.TreeItem {
	constructor(public readonly daemons: DaemonItem[]) {
		super("Global", vscode.TreeItemCollapsibleState.Collapsed);
		this.id = "miseDaemons:global";
		this.description = `(${daemons.length})`;
		this.tooltip = "Daemons of your pitchfork config, in every project";
		this.iconPath = new vscode.ThemeIcon("globe");
	}
}

class MessageItem extends vscode.TreeItem {
	constructor(label: string, tooltip: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.tooltip = tooltip;
		this.iconPath = new vscode.ThemeIcon("warning");
	}
}

/**
 * The Daemons view: the daemons of the current workspace folder, from its mise
 * configs and its pitchfork configs. The state is loaded on every reload, even
 * while the view is hidden, since it tells whether to show the view at all,
 * and polled while the view is visible.
 */
export class MiseDaemonsProvider implements vscode.TreeDataProvider<TreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<
		TreeItem | undefined | null | void
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private _onDidChangeState = new vscode.EventEmitter<void>();
	/** For the code lenses of the daemons */
	readonly onDidChangeState = this._onDidChangeState.event;

	private _state: DaemonsState | undefined;
	/** what is being done to a daemon, or a group, by id */
	private pending = new Map<string, string>();
	private loading: Promise<void> | undefined;
	private reloadAfterLoading = false;

	constructor(private daemonsService: DaemonsService) {}

	get state(): DaemonsState | undefined {
		return this._state;
	}

	/** What is being done to a daemon, e.g. `starting…` */
	pendingLabel(daemon: Daemon): string | undefined {
		return this.pending.get(daemon.id);
	}

	/** Load the daemons again. Calls made while loading wait for one more load. */
	refresh(): Promise<void> {
		if (this.loading) {
			this.reloadAfterLoading = true;
			return this.loading;
		}
		this.loading = (async () => {
			do {
				this.reloadAfterLoading = false;
				await this.load();
			} while (this.reloadAfterLoading);
		})().finally(() => {
			this.loading = undefined;
		});
		return this.loading;
	}

	private async load() {
		let state: DaemonsState | undefined;
		if (isMiseExtensionEnabled()) {
			try {
				state = await this.daemonsService.load();
			} catch (error) {
				logger.info("Could not load the daemons", error);
				state = this._state;
			}
		}
		if (JSON.stringify(state) === JSON.stringify(this._state)) {
			return;
		}
		this._state = state;
		await Promise.all([
			vscode.commands.executeCommand(
				"setContext",
				"mise.hasDaemons",
				!!state?.daemons.length,
			),
			vscode.commands.executeCommand(
				"setContext",
				"mise.hasPitchfork",
				!!state?.pitchfork?.supported,
			),
		]);
		this._onDidChangeTreeData.fire();
		this._onDidChangeState.fire();
	}

	/** Run an action on a daemon, showing it as pending meanwhile */
	runWithPending(daemon: Daemon, action: DaemonAction) {
		return this.runPending(
			[daemon.id],
			PENDING_LABELS[action],
			() => this.daemonsService.run(action, daemon, this._state?.pitchfork),
			`Could not ${action} ${daemon.name}`,
			daemon,
		);
	}

	/** Run an action on the daemons of a group */
	runGroupWithPending(group: DaemonGroup, action: DaemonAction) {
		const members = groupDaemons(
			group,
			this._state?.groups ?? [],
			this._state?.daemons ?? [],
		);
		return this.runPending(
			[groupKey(group), ...members.map((daemon) => daemon.id)],
			PENDING_LABELS[action],
			() =>
				this.daemonsService.runGroup(
					action,
					group,
					members,
					this._state?.pitchfork,
				),
			`Could not ${action} the group ${group.name}`,
		);
	}

	/** Reset the data of a preset */
	resetDataWithPending(daemon: Daemon) {
		return this.runPending(
			[daemon.id],
			"resetting data…",
			() => this.daemonsService.resetData(daemon),
			`Could not reset the data of ${daemon.name}`,
			daemon,
		);
	}

	/**
	 * Run something, showing what it does to the daemons, or groups, it is
	 * about meanwhile. A failure is reported, with the logs of the daemon.
	 */
	private async runPending(
		keys: string[],
		label: string,
		run: () => Promise<void>,
		failure: string,
		daemon?: Daemon,
	) {
		if (keys.some((key) => this.pending.has(key))) {
			return;
		}
		for (const key of keys) {
			this.pending.set(key, label);
		}
		this._onDidChangeTreeData.fire();
		this._onDidChangeState.fire();
		try {
			await vscode.window.withProgress(
				{ location: { viewId: DAEMONS_VIEW_ID } },
				run,
			);
		} catch (error) {
			const showLogs = "Show logs";
			void vscode.window
				.showErrorMessage(
					`${failure}: ${(error as Error).message}`,
					...(daemon ? [showLogs] : []),
				)
				.then((selection) => {
					if (selection === showLogs) {
						void vscode.commands.executeCommand(MISE_SHOW_DAEMON_LOGS, daemon);
					}
				});
		} finally {
			for (const key of keys) {
				this.pending.delete(key);
			}
			// the pending label leaves even when the state did not change
			this._onDidChangeTreeData.fire();
			this._onDidChangeState.fire();
			await this.refresh();
		}
	}

	getTreeItem(element: TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: TreeItem): TreeItem[] {
		if (element instanceof GlobalDaemonsItem || element instanceof GroupItem) {
			return element.daemons;
		}
		if (element instanceof GroupsItem) {
			return element.groups;
		}
		if (element || !this._state) {
			return [];
		}

		const items: TreeItem[] = [];
		const { pitchfork, daemons, groups } = this._state;
		if (pitchfork && !pitchfork.supported) {
			items.push(
				new MessageItem(
					`pitchfork ${pitchfork.version.join(".")} is too old`,
					`mise and the extension need pitchfork ${MIN_PITCHFORK_VERSION.join(".")} or later (${pitchfork.path})`,
				),
			);
		}
		const toItem = (daemon: Daemon) =>
			new DaemonItem(daemon, this.pending.get(daemon.id));
		const groupItems = groups
			.map((group) => {
				const members = groupDaemons(group, groups, daemons);
				return new GroupItem(
					group,
					members.map(
						(daemon) =>
							new DaemonItem(
								daemon,
								this.pending.get(daemon.id),
								`group:${groupKey(group)}/`,
							),
					),
					this.pending.get(groupKey(group)),
				);
			})
			// a group of nothing the view knows about
			.filter((item) => item.daemons.length);
		if (groupItems.length) {
			items.push(new GroupsItem(groupItems));
		}
		items.push(
			...daemons
				.filter((daemon) => daemon.namespace !== GLOBAL_NAMESPACE)
				.map(toItem),
		);
		const global = daemons
			.filter((daemon) => daemon.namespace === GLOBAL_NAMESPACE)
			.map(toItem);
		if (global.length) {
			items.push(new GlobalDaemonsItem(global));
		}
		return items;
	}
}

/** The daemon a command applies to: the clicked item, a code lens argument, or one to pick */
async function resolveDaemon(
	provider: MiseDaemonsProvider,
	argument: unknown,
	filter: (daemon: Daemon) => boolean,
	placeHolder: string,
): Promise<Daemon | undefined> {
	if (argument instanceof DaemonItem) {
		return argument.daemon;
	}
	if (argument && typeof argument === "object" && "id" in argument) {
		return argument as Daemon;
	}

	await provider.refresh();
	const candidates = (provider.state?.daemons ?? []).filter(filter);
	if (!candidates.length) {
		vscode.window.showInformationMessage("No daemon to pick from.");
		return undefined;
	}
	const picked = await vscode.window.showQuickPick(
		candidates.map((daemon) => ({
			label: daemon.name,
			description: describeDaemon(daemon),
			detail: daemon.id,
			daemon,
		})),
		{ placeHolder },
	);
	return picked?.daemon;
}

/** Where a daemon is declared: its mise config, or a pitchfork config */
export async function findDaemonDefinition(
	daemon: Daemon,
	folder: string | undefined,
): Promise<vscode.Location | undefined> {
	const files =
		daemon.kind === "mise"
			? daemon.source
				? [expandPath(daemon.source)]
				: []
			: folder
				? pitchforkConfigCandidates(folder, daemon.namespace).filter((file) =>
						existsSync(file),
					)
				: [];

	for (const file of files) {
		try {
			const document = await vscode.workspace.openTextDocument(
				vscode.Uri.file(file),
			);
			const range = findKeyInTomlDocument(document, ["daemons"], daemon.name);
			if (range) {
				return new vscode.Location(document.uri, range);
			}
		} catch {
			// gone since
		}
	}
	return undefined;
}

/** The group a command applies to: the clicked item, or one to pick */
async function resolveGroup(
	provider: MiseDaemonsProvider,
	argument: unknown,
	placeHolder: string,
): Promise<DaemonGroup | undefined> {
	if (argument instanceof GroupItem) {
		return argument.group;
	}
	if (argument && typeof argument === "object" && "members" in argument) {
		return argument as DaemonGroup;
	}
	await provider.refresh();
	// as the view lists them: the groups of daemons it knows
	const groups = (provider.state?.groups ?? []).filter(
		(group) =>
			groupDaemons(
				group,
				provider.state?.groups ?? [],
				provider.state?.daemons ?? [],
			).length,
	);
	if (!groups.length) {
		vscode.window.showInformationMessage("No group of daemons to pick from.");
		return undefined;
	}
	const picked = await vscode.window.showQuickPick(
		groups.map((group) => ({
			label: group.name,
			description: group.members.join(", "),
			detail: group.sources.join(", "),
			group,
		})),
		{ placeHolder },
	);
	return picked?.group;
}

async function resetDaemonData(
	provider: MiseDaemonsProvider,
	daemonsService: DaemonsService,
	daemon: Daemon,
) {
	if (provider.pendingLabel(daemon)) {
		vscode.window.showInformationMessage(
			`${daemon.name} is busy (${provider.pendingLabel(daemon)}), try again once it is done.`,
		);
		return;
	}
	// before asking: a directory that cannot be reset is not offered
	const dataDir = await daemonsService.resettableDataDir(daemon);
	if (!dataDir) {
		vscode.window.showErrorMessage(
			`The data of ${daemon.name} cannot be reset from here.`,
		);
		return;
	}
	const reset = "Reset data";
	const selection = await vscode.window.showWarningMessage(
		`Reset the data of ${daemon.name}?`,
		{
			modal: true,
			detail: `This stops ${daemon.name}, deletes ${dataDir}, and starts it again with fresh data. Back up anything you want to keep first.`,
		},
		reset,
	);
	if (selection === reset) {
		await provider.resetDataWithPending(daemon);
	}
}

async function openDaemonDefinition(
	daemon: Daemon,
	folder: string | undefined,
) {
	const location = await findDaemonDefinition(daemon, folder);
	if (!location) {
		vscode.window.showInformationMessage(
			`Could not find where the daemon "${daemon.name}" is declared`,
		);
		return;
	}
	const editor = await vscode.window.showTextDocument(location.uri);
	editor.selection = new vscode.Selection(
		location.range.start,
		location.range.end,
	);
	editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
}

export function registerDaemonsCommands(
	context: vscode.ExtensionContext,
	provider: MiseDaemonsProvider,
	daemonsService: DaemonsService,
	folder: () => string | undefined,
) {
	/** by daemon id: `global/web` and `shop/web` both get a `logs web` */
	const terminals = new Map<string, vscode.Terminal>();
	const showInTerminal = (
		key: string,
		name: string,
		command: { shellPath: string; shellArgs: string[] },
		location?: vscode.TerminalLocation,
	) => {
		const previous = terminals.get(key);
		if (previous && previous.exitStatus === undefined) {
			previous.show();
			return;
		}
		previous?.dispose();
		const terminal = vscode.window.createTerminal({
			name,
			cwd: folder(),
			...command,
			location,
		});
		terminals.set(key, terminal);
		terminal.show();
	};

	const runAll = async (action: "start" | "stop") => {
		await provider.refresh();
		const state = provider.state;
		if (!state?.daemons.length) {
			return;
		}
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title:
						action === "start"
							? "Starting the daemons of the project"
							: "Stopping the daemons of the project",
				},
				() => daemonsService.runAll(action, state),
			);
		} catch (error) {
			vscode.window.showErrorMessage(
				`Could not ${action} the daemons: ${(error as Error).message}`,
			);
		} finally {
			await provider.refresh();
		}
	};

	const action =
		(action: DaemonAction, filter: (daemon: Daemon) => boolean) =>
		async (argument: unknown) => {
			const daemon = await resolveDaemon(
				provider,
				argument,
				filter,
				`Daemon to ${action}`,
			);
			if (daemon) {
				await provider.runWithPending(daemon, action);
			}
		};

	context.subscriptions.push(
		vscode.commands.registerCommand(
			MISE_START_DAEMON,
			action("start", (daemon) => !isDaemonActive(daemon)),
		),
		vscode.commands.registerCommand(
			MISE_STOP_DAEMON,
			action("stop", isDaemonActive),
		),
		vscode.commands.registerCommand(
			MISE_RESTART_DAEMON,
			action("restart", () => true),
		),
		vscode.commands.registerCommand(
			MISE_SHOW_DAEMON_LOGS,
			async (argument: unknown) => {
				const daemon = await resolveDaemon(
					provider,
					argument,
					() => true,
					"Daemon whose logs to show",
				);
				if (!daemon) {
					return;
				}
				const command = daemonsService.logsCommand(
					daemon,
					provider.state?.pitchfork,
				);
				if (!command) {
					vscode.window.showWarningMessage(
						"Showing the logs of a daemon requires pitchfork.",
					);
					return;
				}
				showInTerminal(`logs:${daemon.id}`, `logs ${daemon.name}`, command);
			},
		),
		vscode.commands.registerCommand(
			MISE_OPEN_DAEMON_URL,
			async (argument: unknown) => {
				const daemon = await resolveDaemon(
					provider,
					argument,
					(daemon) => !!daemon.url && isDaemonActive(daemon),
					"Daemon to open in the browser",
				);
				if (daemon?.url) {
					await vscode.env.openExternal(vscode.Uri.parse(daemon.url));
				}
			},
		),
		vscode.commands.registerCommand(
			MISE_OPEN_DAEMON_DEFINITION,
			async (argument: unknown) => {
				const daemon = await resolveDaemon(
					provider,
					argument,
					() => true,
					"Daemon to go to",
				);
				if (daemon) {
					await openDaemonDefinition(daemon, folder());
				}
			},
		),
		...(["start", "stop", "restart"] as const).map((groupAction) =>
			vscode.commands.registerCommand(
				{
					start: MISE_START_DAEMON_GROUP,
					stop: MISE_STOP_DAEMON_GROUP,
					restart: MISE_RESTART_DAEMON_GROUP,
				}[groupAction],
				async (argument: unknown) => {
					const group = await resolveGroup(
						provider,
						argument,
						`Group of daemons to ${groupAction}`,
					);
					if (group) {
						await provider.runGroupWithPending(group, groupAction);
					}
				},
			),
		),
		vscode.commands.registerCommand(
			MISE_REVEAL_DAEMON_DATA,
			async (argument: unknown) => {
				const daemon = await resolveDaemon(
					provider,
					argument,
					(daemon) => !!daemon.dataDir,
					"Daemon whose data to reveal",
				);
				if (daemon?.dataDir) {
					await vscode.commands.executeCommand(
						"revealFileInOS",
						vscode.Uri.file(daemon.dataDir),
					);
				}
			},
		),
		vscode.commands.registerCommand(
			MISE_RESET_DAEMON_DATA,
			async (argument: unknown) => {
				const daemon = await resolveDaemon(
					provider,
					argument,
					(daemon) => !!daemon.dataDir,
					"Daemon whose data to reset",
				);
				if (daemon) {
					await resetDaemonData(provider, daemonsService, daemon);
				}
			},
		),
		vscode.commands.registerCommand(MISE_START_ALL_DAEMONS, async () => {
			await runAll("start");
		}),
		vscode.commands.registerCommand(MISE_STOP_ALL_DAEMONS, async () => {
			await runAll("stop");
		}),
		vscode.commands.registerCommand(MISE_OPEN_PITCHFORK_TUI, async () => {
			await provider.refresh();
			const command = daemonsService.tuiCommand(provider.state?.pitchfork);
			if (!command) {
				vscode.window.showWarningMessage(
					"The pitchfork dashboard requires pitchfork.",
				);
				return;
			}
			showInTerminal(
				"tui",
				"pitchfork",
				command,
				vscode.TerminalLocation.Editor,
			);
		}),
		vscode.commands.registerCommand(MISE_OPEN_PITCHFORK_WEB_UI, async () => {
			await provider.refresh();
			const webUi = provider.state?.webUi;
			if (webUi) {
				await vscode.env.openExternal(vscode.Uri.parse(webUi));
				return;
			}
			const learnMore = "Learn more";
			const selection = await vscode.window.showInformationMessage(
				provider.state?.supervisor === "up"
					? "The pitchfork supervisor does not serve its web UI. Set `web.auto_start` in your pitchfork settings, then restart the supervisor."
					: "The pitchfork supervisor is not running. Start a daemon first.",
				learnMore,
			);
			if (selection === learnMore) {
				await vscode.env.openExternal(
					vscode.Uri.parse("https://pitchfork.jdx.dev/guides/web-ui"),
				);
			}
		}),
		{
			dispose: () => {
				for (const terminal of terminals.values()) {
					terminal.dispose();
				}
			},
		},
	);
}

/**
 * Poll the daemons in a focused window: often while the view is visible, less
 * so while it is hidden and a daemon runs, which the failure notifications
 * and the status bar follow (see DaemonsStatus). Not at all otherwise.
 */
export function pollDaemons(
	treeView: vscode.TreeView<unknown>,
	provider: MiseDaemonsProvider,
): vscode.Disposable {
	let timer: ReturnType<typeof setInterval> | undefined;
	let interval: number | undefined;
	const update = () => {
		const running = provider.state?.daemons.some(isDaemonActive) ?? false;
		const next = !vscode.window.state.focused
			? undefined
			: treeView.visible
				? POLL_INTERVAL_MS
				: running
					? HIDDEN_POLL_INTERVAL_MS
					: undefined;
		if (next === interval) {
			return;
		}
		clearInterval(timer);
		timer = undefined;
		interval = next;
		if (next !== undefined) {
			void provider.refresh();
			timer = setInterval(() => void provider.refresh(), next);
		}
	};
	const listeners = [
		treeView.onDidChangeVisibility(update),
		vscode.window.onDidChangeWindowState(update),
		provider.onDidChangeState(update),
	];
	update();
	return {
		dispose: () => {
			clearInterval(timer);
			for (const listener of listeners) {
				listener.dispose();
			}
		},
	};
}
