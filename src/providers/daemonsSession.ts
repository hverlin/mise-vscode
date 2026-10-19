import * as vscode from "vscode";
import {
	CONFIGURATION_FLAGS,
	isMiseExtensionEnabled,
	shouldAutoStartStopDaemons,
} from "../configuration";
import type { DaemonsService, PitchforkBinary } from "../daemonsService";
import { logger } from "../utils/logger";

/**
 * With `mise.autoStartStopDaemons`, each workspace folder whose daemons start
 * or stop with a session (`auto = ["start", "stop"]`) gets a pitchfork
 * session for this window, as a shell gets one when it enters the folder.
 *
 * A folder is entered again only when its session daemons change, since
 * entering starts them again: a daemon the user stopped stays stopped.
 */
export class DaemonsSession implements vscode.Disposable {
	/** the folders entered, with what they were entered for */
	private entered = new Map<
		string,
		{ pitchfork: PitchforkBinary; daemons: string }
	>();
	private syncing: Promise<void> = Promise.resolve();
	private listeners: vscode.Disposable[];

	constructor(private daemonsService: DaemonsService) {
		this.listeners = [
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.sync()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (
					event.affectsConfiguration(
						`mise.${CONFIGURATION_FLAGS.autoStartStopDaemons}`,
					)
				) {
					void this.sync();
				}
			}),
		];
	}

	/** Enter the folders that have session daemons, and leave the others */
	sync(): Promise<void> {
		this.syncing = this.syncing
			.then(() => this.syncNow())
			.catch((error) => {
				logger.warn(`Could not update the daemon sessions: ${error}`);
			});
		return this.syncing;
	}

	private async syncNow() {
		const enabled =
			isMiseExtensionEnabled() &&
			shouldAutoStartStopDaemons() &&
			vscode.workspace.isTrusted;
		const pitchfork = enabled
			? await this.daemonsService.findPitchfork()
			: undefined;

		const wanted = new Map<string, { daemons: string; register: boolean }>();
		if (pitchfork?.supported) {
			for (const folder of vscode.workspace.workspaceFolders ?? []) {
				const { daemons, register } = await this.daemonsService.sessionDaemons(
					folder.uri.fsPath,
				);
				if (daemons.length) {
					wanted.set(folder.uri.fsPath, {
						daemons: daemons.join("\n"),
						register,
					});
				}
			}
		}

		for (const [folder, session] of this.entered) {
			if (!wanted.has(folder)) {
				this.entered.delete(folder);
				await this.leave(folder, session.pitchfork);
			}
		}
		if (!pitchfork) {
			return;
		}
		for (const [folder, { daemons, register }] of wanted) {
			if (this.entered.get(folder)?.daemons === daemons) {
				continue;
			}
			try {
				await this.daemonsService.enterSession(folder, pitchfork, {
					register,
				});
				this.entered.set(folder, { pitchfork, daemons });
				logger.info(`Entered the daemon session of ${folder}`);
			} catch (error) {
				logger.warn(
					`Could not enter the daemon session of ${folder}: ${(error as Error).message}`,
				);
			}
		}
	}

	private async leave(folder: string, pitchfork: PitchforkBinary) {
		try {
			await this.daemonsService.leaveSession(folder, pitchfork);
			logger.info(`Left the daemon session of ${folder}`);
		} catch (error) {
			logger.warn(
				`Could not leave the daemon session of ${folder}: ${(error as Error).message}`,
			);
		}
	}

	dispose() {
		for (const listener of this.listeners) {
			listener.dispose();
		}
		// pitchfork also ends them once this process exits
		for (const [folder, session] of this.entered) {
			void this.leave(folder, session.pitchfork);
		}
		this.entered.clear();
	}
}
