import * as vscode from "vscode";
import {
	MISE_OPEN_DAEMON_URL,
	MISE_RESTART_DAEMON,
	MISE_SHOW_DAEMON_LOGS,
	MISE_START_DAEMON,
	MISE_STOP_DAEMON,
} from "../commands";
import { isCodeLensEnabled } from "../configuration";
import {
	type Daemon,
	declaredDaemonNames,
	describeDaemon,
	GLOBAL_NAMESPACE,
	isDaemonActive,
	isPitchforkConfigPath,
	isSamePath,
	pitchforkConfigCandidates,
	pitchforkNamespace,
} from "../utils/daemons";
import { expandPath } from "../utils/fileUtils";
import { getCachedTomlParser } from "../utils/miseFileParser";
import { isMiseConfigPath } from "../utils/miseUtilts";
import {
	DAEMONS_VIEW_ID,
	type MiseDaemonsProvider,
	PENDING_LABELS,
} from "./daemonsProvider";

/**
 * Over each daemon a config declares: its status, and what can be done with
 * it, as in the Daemons view.
 */
export class DaemonCodeLensProvider implements vscode.CodeLensProvider {
	readonly onDidChangeCodeLenses: vscode.Event<void>;

	constructor(
		private provider: MiseDaemonsProvider,
		/** the folder whose daemons the provider knows */
		private folder: () => string | undefined,
	) {
		this.onDidChangeCodeLenses = provider.onDidChangeState;
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const daemons = this.provider.state?.daemons;
		if (!isCodeLensEnabled() || !daemons?.length) {
			return [];
		}
		const filePath = document.uri.fsPath;
		const isPitchfork = isPitchforkConfigPath(filePath);
		if (!isPitchfork && !isMiseConfigPath(filePath)) {
			return [];
		}

		const parser = getCachedTomlParser(document);
		const table = (parser?.parsed as { daemons?: object } | undefined)?.daemons;
		if (!parser || !table) {
			return [];
		}
		const namespace = isPitchfork
			? pitchforkNamespace(filePath, parser.parsed)
			: undefined;
		// another folder's config may declare daemons of the same name
		const folder = this.folder();
		if (
			namespace !== undefined &&
			!(
				folder &&
				pitchforkConfigCandidates(folder, namespace).some((candidate) =>
					isSamePath(candidate, filePath),
				)
			)
		) {
			return [];
		}

		const lenses: vscode.CodeLens[] = [];
		for (const name of declaredDaemonNames(parser.parsed)) {
			const range = parser.findRange(table, name);
			if (!range) {
				continue;
			}
			const daemon = isPitchfork
				? this.pitchforkDaemon(daemons, name, namespace)
				: daemons.find(
						(daemon) =>
							daemon.kind === "mise" &&
							daemon.name === name &&
							!!daemon.source &&
							isSamePath(expandPath(daemon.source), filePath),
					);
			if (daemon) {
				lenses.push(...this.lensesOf(daemon, range));
			}
		}
		return lenses;
	}

	private pitchforkDaemon(
		daemons: Daemon[],
		name: string,
		namespace: string | undefined,
	): Daemon | undefined {
		const candidates = daemons.filter(
			(daemon) =>
				daemon.name === name &&
				(namespace === GLOBAL_NAMESPACE) ===
					(daemon.namespace === GLOBAL_NAMESPACE),
		);
		// mise's own daemons are registered with pitchfork too, under the same
		// namespace when a pitchfork config sits next to the mise one
		return (
			candidates.find(
				(daemon) =>
					daemon.kind === "pitchfork" && daemon.namespace === namespace,
			) ??
			(candidates.length === 1 && candidates[0]?.kind === "pitchfork"
				? candidates[0]
				: undefined)
		);
	}

	private lensesOf(daemon: Daemon, range: vscode.Range): vscode.CodeLens[] {
		const pending = this.provider.pendingAction(daemon);
		const lens = (title: string, command: string) =>
			new vscode.CodeLens(range, { title, command, arguments: [daemon] });

		const status = pending
			? `$(loading~spin) ${PENDING_LABELS[pending]}`
			: `$(${isDaemonActive(daemon) ? "pass-filled" : "circle-large-outline"}) ${describeDaemon(daemon)}`;
		const lenses = [
			new vscode.CodeLens(range, {
				title: status,
				command: `${DAEMONS_VIEW_ID}.focus`,
				tooltip: "Show the Daemons view",
			}),
		];
		if (pending) {
			return lenses;
		}
		if (isDaemonActive(daemon)) {
			lenses.push(
				lens("$(debug-stop) Stop", MISE_STOP_DAEMON),
				lens("$(debug-restart) Restart", MISE_RESTART_DAEMON),
			);
			if (daemon.url) {
				lenses.push(lens("$(globe) Open", MISE_OPEN_DAEMON_URL));
			}
		} else {
			lenses.push(lens("$(play) Start", MISE_START_DAEMON));
		}
		lenses.push(lens("$(output) Logs", MISE_SHOW_DAEMON_LOGS));
		return lenses;
	}
}
