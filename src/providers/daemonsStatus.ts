import * as vscode from "vscode";
import { MISE_RESTART_DAEMON, MISE_SHOW_DAEMON_LOGS } from "../commands";
import {
	CONFIGURATION_FLAGS,
	shouldNotifyDaemonFailures,
	shouldShowDaemonsInStatusBar,
} from "../configuration";
import {
	type Daemon,
	describeDaemon,
	GLOBAL_NAMESPACE,
	isDaemonActive,
	isDaemonFailed,
	newlyFailedDaemons,
	summarizeDaemons,
} from "../utils/daemons";
import { markdownCodeSpan } from "../utils/markdown";
import { DAEMONS_VIEW_ID, type MiseDaemonsProvider } from "./daemonsProvider";

/**
 * What the daemons are up to, outside the Daemons view: a notification when a
 * running daemon fails, and a status bar item with how many run and failed.
 * Both follow the state the view polls, see pollDaemons.
 */
export class DaemonsStatus implements vscode.Disposable {
	private item = vscode.window.createStatusBarItem(
		"mise.daemons",
		vscode.StatusBarAlignment.Left,
		-1,
	);
	/** the status of each daemon at the previous update, by id */
	private previous = new Map<string, string>();
	/** the daemons whose failure was notified and is not dismissed yet */
	private open = new Set<string>();
	/** the daemons seen failing since the window opened, while they still do */
	private failedHere = new Set<string>();
	private listeners: vscode.Disposable[];

	constructor(private provider: MiseDaemonsProvider) {
		this.item.name = "mise daemons";
		this.item.command = `${DAEMONS_VIEW_ID}.focus`;
		this.listeners = [
			provider.onDidChangeState(() => this.update()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (
					event.affectsConfiguration(
						`mise.${CONFIGURATION_FLAGS.showDaemonsInStatusBar}`,
					)
				) {
					this.update();
				}
			}),
		];
	}

	private update() {
		// the daemons of the project: those of the user's pitchfork config
		// belong to every window
		const daemons = (this.provider.state?.daemons ?? []).filter(
			(daemon) => daemon.namespace !== GLOBAL_NAMESPACE,
		);
		// a daemon the user is acting on reports its own failure: its status
		// once the action is done is where its watch starts again
		const settled = daemons.filter(
			(daemon) => !this.provider.pendingLabel(daemon),
		);
		for (const daemon of daemons) {
			if (this.provider.pendingLabel(daemon)) {
				this.previous.delete(daemon.id);
			}
		}
		for (const daemon of newlyFailedDaemons(this.previous, settled)) {
			this.failedHere.add(daemon.id);
			// once while its notification is open: pitchfork may retry it
			if (shouldNotifyDaemonFailures() && !this.open.has(daemon.id)) {
				void this.alert(daemon);
			}
		}
		for (const daemon of settled) {
			this.previous.set(daemon.id, daemon.status);
		}
		for (const id of this.failedHere) {
			const daemon = daemons.find((candidate) => candidate.id === id);
			if (!daemon || !isDaemonFailed(daemon)) {
				this.failedHere.delete(id);
			}
		}
		this.updateItem(daemons);
	}

	private updateItem(daemons: Daemon[]) {
		// a failure from before the window opened is the view's to show
		const { running, failed, text } = summarizeDaemons(
			daemons.filter(
				(daemon) => !isDaemonFailed(daemon) || this.failedHere.has(daemon.id),
			),
		);
		if (!shouldShowDaemonsInStatusBar() || (!running && !failed)) {
			this.item.hide();
			return;
		}
		this.item.text = text;
		this.item.backgroundColor = failed
			? new vscode.ThemeColor("statusBarItem.errorBackground")
			: undefined;
		const lines = daemons
			.filter((daemon) => isDaemonActive(daemon) || isDaemonFailed(daemon))
			.map(
				(daemon) =>
					`- ${markdownCodeSpan(daemon.name)} ${describeDaemon(daemon)}${daemon.error ? `: ${daemon.error}` : ""}`,
			);
		this.item.tooltip = new vscode.MarkdownString(
			[`**mise daemons**: ${running} running`, ...lines].join("\n\n"),
		);
		this.item.show();
	}

	private async alert(daemon: Daemon) {
		const showLogs = "Show logs";
		const restart = "Restart";
		this.open.add(daemon.id);
		const selection = await Promise.resolve(
			vscode.window.showWarningMessage(
				`Daemon ${daemon.name} failed${daemon.error ? `: ${daemon.error}` : ""}`,
				showLogs,
				restart,
			),
		).finally(() => this.open.delete(daemon.id));
		if (selection === showLogs) {
			await vscode.commands.executeCommand(MISE_SHOW_DAEMON_LOGS, daemon);
		} else if (selection === restart) {
			await vscode.commands.executeCommand(MISE_RESTART_DAEMON, daemon);
		}
	}

	dispose() {
		this.item.dispose();
		for (const listener of this.listeners) {
			listener.dispose();
		}
	}
}
