import * as vscode from "vscode";
import {
	CONFIGURATION_FLAGS,
	isMiseExtensionEnabled,
	shouldAutoStartStopDaemons,
} from "../configuration";
import type { DaemonsService, PitchforkBinary } from "../daemonsService";
import { logger } from "../utils/logger";

type SessionRoots = Map<string, { daemons: string[]; register: boolean }>;

/**
 * With `mise.autoStartStopDaemons`, each project of the workspace folders
 * whose daemons start or stop with a session (`auto = ["start", "stop"]`) gets
 * a pitchfork session for this window, as a shell gets one when it enters it.
 *
 * A project is entered again only when its session daemons change, since
 * entering starts them again: a daemon the user stopped stays stopped. That
 * holds when entering failed too, rather than trying again on every reload.
 */
export class DaemonsSession implements vscode.Disposable {
	/** the project roots entered, with the session daemons they were entered for */
	private entered = new Map<
		string,
		{ pitchfork: PitchforkBinary; daemons: string }
	>();
	/** what each folder last read, kept while one of its configs does not */
	private lastRead = new Map<string, SessionRoots>();
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

	/** Enter the projects that have session daemons, and leave the others */
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
		const folders = pitchfork?.supported
			? (vscode.workspace.workspaceFolders ?? []).map(
					(folder) => folder.uri.fsPath,
				)
			: [];
		for (const folder of folders) {
			const roots =
				(await this.daemonsService.sessionRoots(folder)) ??
				this.lastRead.get(folder);
			if (!roots) {
				continue;
			}
			this.lastRead.set(folder, roots);
			for (const [root, { daemons, register }] of roots) {
				const previous = wanted.get(root);
				wanted.set(root, {
					daemons: daemons.join("\n"),
					register: register || !!previous?.register,
				});
			}
		}
		for (const folder of this.lastRead.keys()) {
			if (!folders.includes(folder)) {
				this.lastRead.delete(folder);
			}
		}

		for (const [root, session] of this.entered) {
			if (!wanted.has(root)) {
				this.entered.delete(root);
				await this.leave(root, session.pitchfork);
			}
		}
		if (!pitchfork) {
			return;
		}
		for (const [root, { daemons, register }] of wanted) {
			if (this.entered.get(root)?.daemons === daemons) {
				continue;
			}
			this.entered.set(root, { pitchfork, daemons });
			try {
				await this.daemonsService.enterSession(root, pitchfork, { register });
				logger.info(`Entered the daemon session of ${root}`);
			} catch (error) {
				logger.warn(
					`Could not enter the daemon session of ${root}: ${(error as Error).message}`,
				);
			}
		}
	}

	private async leave(root: string, pitchfork: PitchforkBinary) {
		try {
			await this.daemonsService.leaveSession(root, pitchfork);
			logger.info(`Left the daemon session of ${root}`);
		} catch (error) {
			logger.warn(
				`Could not leave the daemon session of ${root}: ${(error as Error).message}`,
			);
		}
	}

	dispose() {
		for (const listener of this.listeners) {
			listener.dispose();
		}
		// pitchfork also ends them once this process exits
		for (const [root, session] of this.entered) {
			void this.leave(root, session.pitchfork);
		}
		this.entered.clear();
	}
}
