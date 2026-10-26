import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as vscode from "vscode";
import {
	type DocumentSelector,
	LanguageClient,
	RevealOutputChannelOn,
} from "vscode-languageclient/node";
import {
	areTaskDiagnosticsEnabled,
	isLanguageServerEnabled,
	isMiseExtensionEnabled,
} from "../configuration";
import type { MiseService } from "../miseService";
import {
	getInitializationOptions,
	isOn,
	isTaskOrToolCompletion,
	isTaskOrToolHover,
	sameDiagnostics,
	splitDiagnostics,
	TOML_EXTENSION_IDS,
} from "../utils/languageServer";
import { logger } from "../utils/logger";
import { safeExec } from "../utils/shell";

/**
 * The config files `mise lsp` answers for (`is_mise_config` of the mise-lsp
 * crate). Other TOML files are not sent to it: it would be offered as their
 * formatter, and answer nothing.
 */
export const MISE_CONFIG_SELECTOR = [
	"**/{mise,.mise}.toml",
	"**/{mise,.mise}.*.toml",
	"**/{mise,.mise}/config.toml",
	"**/{mise,.mise}/config.*.toml",
	"**/{mise,.mise}/conf.d/*.toml",
].map((pattern) => ({ scheme: "file", language: "toml", pattern }));

/**
 * Whether this mise has `mise lsp` (2026.10.18+). A mise without it takes
 * `lsp` for a task name, and `mise lsp --help` shows the help of a task named
 * `lsp`, whose description can look like the command's: `mise help lsp` shows
 * mise's own.
 */
async function hasLanguageServer(binPath: string): Promise<boolean> {
	try {
		const { code, stdout } = await safeExec(binPath, ["help", "lsp"], {
			cwd: tmpdir(),
			timeout: 10_000,
		});
		return code === 0 && /^Usage: mise lsp\b/m.test(stdout);
	} catch {
		return false;
	}
}

type ServerOptions = {
	binPath: string;
	initializationOptions: ReturnType<typeof getInitializationOptions>;
};

/**
 * Runs `mise lsp` for the mise config files, when `mise.enableLanguageServer`
 * is on and the mise binary has the command: diagnostics with quick fixes,
 * completion and hover of the keys, formatting and rename. What this
 * extension already does from the tasks and tools mise resolves (task and
 * tool names, definitions, references) is left to it, and what a TOML
 * extension does to that extension.
 */
export class MiseLanguageServer implements vscode.Disposable {
	private client: LanguageClient | undefined;
	/** what the client runs with, see ServerOptions */
	private running: string | undefined;
	/** whether each binary has `mise lsp`, by path and mtime: mise updates itself in place */
	private readonly supported = new Map<string, Promise<boolean>>();
	private syncing: Promise<void> = Promise.resolve();
	/** the diagnostics of the server, by document, see publish */
	private readonly reported = new Map<string, vscode.Diagnostic[]>();
	/** the diagnostics of the server not shown, kept for their quick fixes */
	private readonly hidden = new Map<string, vscode.Diagnostic[]>();

	/** a TOML extension, or the task diagnostics, report a problem or stop reporting it */
	private readonly diagnosticsListener =
		vscode.languages.onDidChangeDiagnostics((event) => {
			for (const uri of event.uris) {
				const diagnostics = this.reported.get(uri.toString());
				if (diagnostics) {
					const shown = this.filter(uri, diagnostics);
					const collection = this.client?.diagnostics;
					if (
						collection &&
						!sameDiagnostics(collection.get(uri) ?? [], shown)
					) {
						collection.set(uri, shown);
					}
				}
			}
		});

	constructor(private readonly miseService: MiseService) {}

	/** Whether `mise lsp` serves the config files, in place of what it replaces here */
	get isRunning(): boolean {
		return this.client !== undefined;
	}

	/**
	 * Starts, restarts or stops the server to follow the settings, the binary
	 * and the TOML extensions. Called on every reload.
	 */
	sync(): Promise<void> {
		this.syncing = this.syncing
			.then(async () => {
				const options = await this.wantedOptions();
				const key = options && JSON.stringify(options);
				if (key === this.running) {
					return;
				}
				await this.stop();
				if (options) {
					await this.start(options);
					this.running = key;
				}
			})
			.catch((error) => {
				logger.warn("Could not start mise lsp:", error as Error);
			});
		return this.syncing;
	}

	private async wantedOptions(): Promise<ServerOptions | undefined> {
		const binPath = this.miseService.getMiseBinaryPath();
		// nothing may run against a binary the user has not approved
		if (
			!binPath ||
			!isMiseExtensionEnabled() ||
			!isLanguageServerEnabled() ||
			this.miseService.pendingBinaryApproval
		) {
			return undefined;
		}
		const modified = await stat(binPath).then(
			(stats) => stats.mtimeMs,
			() => undefined,
		);
		const key = `${binPath}:${modified}`;
		let supported = this.supported.get(key);
		if (!supported) {
			supported = hasLanguageServer(binPath);
			this.supported.set(key, supported);
		}
		if (!(await supported)) {
			logger.info(`${binPath} has no \`mise lsp\` (mise 2026.10.18+)`);
			return undefined;
		}
		const hasTomlExtension = TOML_EXTENSION_IDS.some(
			(id) => vscode.extensions.getExtension(id) !== undefined,
		);
		return {
			binPath,
			initializationOptions: getInitializationOptions(hasTomlExtension),
		};
	}

	private async start({ binPath, initializationOptions }: ServerOptions) {
		const client = new LanguageClient(
			"mise",
			"mise language server",
			{
				command: binPath,
				args: ["lsp"],
				// it reads nothing from disk, but mise starts in a folder
				options: {
					cwd: this.miseService.getCurrentWorkspaceFolderPath() ?? tmpdir(),
				},
			},
			{
				documentSelector: MISE_CONFIG_SELECTOR as DocumentSelector,
				initializationOptions,
				revealOutputChannelOn: RevealOutputChannelOn.Never,
				middleware: {
					handleDiagnostics: (uri, diagnostics, next) => {
						this.reported.set(uri.toString(), diagnostics);
						next(uri, this.filter(uri, diagnostics));
					},
					// a hidden diagnostic still gets its quick fix, on the one shown
					provideCodeActions: (document, range, context, token, next) => {
						const hidden = (
							this.hidden.get(document.uri.toString()) ?? []
						).filter((diagnostic) => isOn(diagnostic, range));
						return next(
							document,
							range,
							hidden.length
								? {
										...context,
										diagnostics: [...context.diagnostics, ...hidden],
									}
								: context,
							token,
						);
					},
					provideHover: async (document, position, token, next) => {
						const hover = await next(document, position, token);
						return hover && isTaskOrToolHover(hover) ? undefined : hover;
					},
					provideCompletionItem: async (
						document,
						position,
						context,
						token,
						next,
					) => {
						const result = await next(document, position, context, token);
						if (!result) {
							return result;
						}
						if (Array.isArray(result)) {
							return result.filter((item) => !isTaskOrToolCompletion(item));
						}
						result.items = result.items.filter(
							(item) => !isTaskOrToolCompletion(item),
						);
						return result;
					},
					didClose: (document, next) => {
						this.reported.delete(document.uri.toString());
						this.hidden.delete(document.uri.toString());
						return next(document);
					},
				},
			},
		);
		this.client = client;
		try {
			await client.start();
		} catch (error) {
			this.client = undefined;
			await client.dispose().catch(() => {});
			throw error;
		}
		logger.info(`Started ${binPath} lsp`);
	}

	/**
	 * The diagnostics of the server to show, but those another extension
	 * already reports, see splitDiagnostics
	 */
	private filter(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) {
		const { shown, hidden } = splitDiagnostics(
			diagnostics,
			vscode.languages.getDiagnostics(uri),
			areTaskDiagnosticsEnabled(),
		);
		this.hidden.set(uri.toString(), hidden);
		return shown;
	}

	private async stop() {
		const client = this.client;
		this.client = undefined;
		this.running = undefined;
		this.reported.clear();
		this.hidden.clear();
		if (client) {
			logger.info("Stopping mise lsp");
			await client.stop(2000).catch(() => {});
			await client.dispose();
		}
	}

	dispose() {
		this.diagnosticsListener.dispose();
		void this.stop();
	}
}
