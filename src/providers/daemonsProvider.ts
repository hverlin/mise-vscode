import { existsSync } from "node:fs";
import * as vscode from "vscode";
import {
	MISE_OPEN_DAEMON_DEFINITION,
	MISE_OPEN_DAEMON_URL,
	MISE_OPEN_PITCHFORK_TUI,
	MISE_OPEN_PITCHFORK_WEB_UI,
	MISE_RESTART_DAEMON,
	MISE_SHOW_DAEMON_LOGS,
	MISE_START_ALL_DAEMONS,
	MISE_START_DAEMON,
	MISE_STOP_ALL_DAEMONS,
	MISE_STOP_DAEMON,
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
	describeDaemon,
	GLOBAL_NAMESPACE,
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

export const PENDING_LABELS: Record<DaemonAction, string> = {
	start: "starting…",
	stop: "stopping…",
	restart: "restarting…",
};

type TreeItem = DaemonItem | GlobalDaemonsItem | MessageItem;

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
		pending: DaemonAction | undefined,
	) {
		super(daemon.name, vscode.TreeItemCollapsibleState.None);
		this.id = daemon.id;
		this.description = pending
			? PENDING_LABELS[pending]
			: describeDaemon(daemon);
		this.tooltip = daemonTooltip(daemon);
		this.iconPath = daemonIcon(daemon, !!pending);
		// e.g. `miseDaemon;active;url`, matched with `viewItem =~ /;active/`
		this.contextValue = [
			"miseDaemon",
			isDaemonActive(daemon) ? "active" : "inactive",
			...(daemon.url ? ["url"] : []),
		].join(";");
		this.command = {
			command: MISE_OPEN_DAEMON_DEFINITION,
			title: "Open Definition",
			arguments: [daemon],
		};
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
	private pending = new Map<string, DaemonAction>();
	private loading: Promise<void> | undefined;
	private reloadAfterLoading = false;

	constructor(private daemonsService: DaemonsService) {}

	get state(): DaemonsState | undefined {
		return this._state;
	}

	pendingAction(daemon: Daemon): DaemonAction | undefined {
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
	async runWithPending(daemon: Daemon, action: DaemonAction) {
		if (this.pending.has(daemon.id)) {
			return;
		}
		this.pending.set(daemon.id, action);
		this._onDidChangeTreeData.fire();
		this._onDidChangeState.fire();
		try {
			await vscode.window.withProgress(
				{ location: { viewId: DAEMONS_VIEW_ID } },
				() => this.daemonsService.run(action, daemon, this._state?.pitchfork),
			);
		} catch (error) {
			const showLogs = "Show logs";
			void vscode.window
				.showErrorMessage(
					`Could not ${action} ${daemon.name}: ${(error as Error).message}`,
					showLogs,
				)
				.then((selection) => {
					if (selection === showLogs) {
						void vscode.commands.executeCommand(MISE_SHOW_DAEMON_LOGS, daemon);
					}
				});
		} finally {
			this.pending.delete(daemon.id);
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
		if (element instanceof GlobalDaemonsItem) {
			return element.daemons;
		}
		if (element || !this._state) {
			return [];
		}

		const items: TreeItem[] = [];
		const { pitchfork, daemons } = this._state;
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

/** Poll the daemons while the view is visible, in a focused window */
export function pollWhileVisible(
	treeView: vscode.TreeView<unknown>,
	provider: MiseDaemonsProvider,
): vscode.Disposable {
	let timer: ReturnType<typeof setInterval> | undefined;
	const update = () => {
		const shouldPoll = treeView.visible && vscode.window.state.focused;
		if (shouldPoll && !timer) {
			void provider.refresh();
			timer = setInterval(() => void provider.refresh(), POLL_INTERVAL_MS);
		} else if (!shouldPoll && timer) {
			clearInterval(timer);
			timer = undefined;
		}
	};
	const listeners = [
		treeView.onDidChangeVisibility(update),
		vscode.window.onDidChangeWindowState(update),
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
