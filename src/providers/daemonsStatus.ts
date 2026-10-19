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
		const daemons = this.provider.state?.daemons ?? [];
		// a daemon the user is acting on reports its own failure
		const settled = daemons.filter(
			(daemon) => !this.provider.pendingLabel(daemon),
		);
		if (shouldNotifyDaemonFailures()) {
			for (const daemon of newlyFailedDaemons(this.previous, settled)) {
				void this.alert(daemon);
			}
		}
		this.previous = new Map(
			settled.map((daemon) => [daemon.id, daemon.status]),
		);
		this.updateItem(daemons);
	}

	private updateItem(daemons: Daemon[]) {
		const { running, failed, text } = summarizeDaemons(daemons);
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
		const selection = await vscode.window.showWarningMessage(
			`Daemon ${daemon.name} failed${daemon.error ? `: ${daemon.error}` : ""}`,
			showLogs,
			restart,
		);
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
