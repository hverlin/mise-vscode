import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as vscode from "vscode";
import {
	CloseAction,
	type DocumentSelector,
	ErrorAction,
	type ErrorHandler,
	LanguageClient,
	RevealOutputChannelOn,
	State,
} from "vscode-languageclient/node";
import {
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
 * mise's own. False also when mise could not answer, e.g. in time.
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
	/** a client that gave up restarting the server, disposed on the next stop */
	private stopped: LanguageClient | undefined;
	private disposed = false;
	/** the binaries that have `mise lsp`, by path and mtime: mise updates itself in place */
	private readonly supported = new Set<string>();
	private syncing: Promise<void> = Promise.resolve();
	/** shared by the clients, so that the logs of a crash stay after a restart */
	private readonly outputChannel = vscode.window.createOutputChannel(
		"mise language server",
		{ log: true },
	);
	private readonly stopEmitter = new vscode.EventEmitter<void>();
	/** The server stopped on its own, after crashing too often */
	readonly onDidStop = this.stopEmitter.event;
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
				if (this.disposed) {
					return;
				}
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
		// only a binary that has it is remembered: a check that timed out is
		// done again on the next reload
		if (!this.supported.has(key)) {
			if (!(await hasLanguageServer(binPath))) {
				logger.info(`${binPath} has no \`mise lsp\` (mise 2026.10.18+)`);
				return undefined;
			}
			this.supported.add(key);
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
		let defaultErrorHandler: ErrorHandler | undefined;
		const errorHandler = (): ErrorHandler => {
			defaultErrorHandler ??= client.createDefaultErrorHandler();
			return defaultErrorHandler;
		};
		const client: LanguageClient = new LanguageClient(
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
				outputChannel: this.outputChannel,
				revealOutputChannelOn: RevealOutputChannelOn.Never,
				// restarts the server like the default, but notices when it gives up
				errorHandler: {
					error: async (error, message, count) => {
						const result = await errorHandler().error(error, message, count);
						if (result.action === ErrorAction.Shutdown) {
							this.gaveUp(client);
						}
						return result;
					},
					closed: async () => {
						const result = await errorHandler().closed();
						if (result.action === CloseAction.DoNotRestart) {
							this.gaveUp(client);
						}
						return result;
					},
				},
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
	 * The server crashed too often and is not restarted: what it replaces comes
	 * back, and it starts again on the next reload
	 */
	private gaveUp(client: LanguageClient) {
		if (this.client !== client) {
			return;
		}
		logger.warn("mise lsp stopped, it starts again on the next reload");
		this.client = undefined;
		this.running = undefined;
		this.stopped = client;
		this.reported.clear();
		this.hidden.clear();
		this.stopEmitter.fire();
	}

	/**
	 * The diagnostics of the server to show, but those another extension
	 * already reports, see splitDiagnostics
	 */
	private filter(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) {
		const { shown, hidden } = splitDiagnostics(
			diagnostics,
			vscode.languages.getDiagnostics(uri),
		);
		this.hidden.set(uri.toString(), hidden);
		return shown;
	}

	private async stop() {
		const clients = [this.client, this.stopped].filter(
			(client) => client !== undefined,
		);
		this.client = undefined;
		this.stopped = undefined;
		this.running = undefined;
		this.reported.clear();
		this.hidden.clear();
		for (const client of clients) {
			logger.info("Stopping mise lsp");
			// a client restarting the server can only stop once it is running
			if (client.state === State.Starting) {
				await client.start().catch(() => {});
			}
			await client.dispose(2000).catch(() => {});
		}
	}

	dispose() {
		this.disposed = true;
		this.diagnosticsListener.dispose();
		this.stopEmitter.dispose();
		// after a start in progress
		this.syncing = this.syncing
			.then(() => this.stop())
			.finally(() => this.outputChannel.dispose());
	}
}
