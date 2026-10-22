import * as vscode from "vscode";
import { getMcpServers, isMiseExtensionEnabled } from "../configuration";
import type { DaemonsService } from "../daemonsService";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import { buildMcpServers } from "../utils/mcpServers";

/** The id of `contributes.mcpServerDefinitionProviders` in package.json */
export const MCP_PROVIDER_ID = "mise.mcpServers";

/** `mise mcp` no longer needs `experimental = true` since 2026.6.6 */
const MIN_MISE_VERSION_FOR_MCP = [2026, 6, 6] as const;

/**
 * Provides `mise mcp` and `pitchfork mcp` to the agents of VS Code, as enabled
 * in `mise.mcpServers`, in the current workspace folder. Nothing on a VS Code
 * fork without the MCP API.
 *
 * @returns what to call when the servers may have changed: on every reload,
 * which also follows a change of the setting
 */
export function registerMcpServers(
	context: vscode.ExtensionContext,
	miseService: MiseService,
	daemonsService: DaemonsService,
): () => void {
	/** the version of each mise binary, as reloads happen on every save */
	const miseVersions = new Map<string, Promise<string>>();
	const miseVersion = (path: string) => {
		if (!miseVersions.has(path)) {
			miseVersions.set(path, miseService.getVersion());
		}
		return miseVersions.get(path) as Promise<string>;
	};

	/** the servers enabled that can run, in the current folder */
	const currentServers = async () => {
		const enabled = getMcpServers();
		if (!enabled.length || !isMiseExtensionEnabled()) {
			return [];
		}
		const misePath = miseService.getMiseBinaryPath();
		const pitchfork = enabled.includes("pitchfork")
			? await daemonsService.findPitchfork()
			: undefined;
		return buildMcpServers({
			enabled,
			folder: miseService.getCurrentWorkspaceFolderPath(),
			mise:
				misePath &&
				enabled.includes("mise") &&
				(await miseService.hasValidMiseVersion(MIN_MISE_VERSION_FOR_MCP))
					? {
							path: misePath,
							globalArgs: miseService.buildMiseArgs([]),
							version: await miseVersion(misePath),
						}
					: undefined,
			pitchfork: pitchfork?.supported
				? { path: pitchfork.path, version: pitchfork.version }
				: undefined,
		});
	};
	let provided = "[]";

	const changed = new vscode.EventEmitter<void>();
	let registration: vscode.Disposable;
	try {
		registration = vscode.lm.registerMcpServerDefinitionProvider(
			MCP_PROVIDER_ID,
			{
				onDidChangeMcpServerDefinitions: changed.event,
				provideMcpServerDefinitions: async () => {
					const servers = await currentServers();
					provided = JSON.stringify(servers);
					logger.info(
						`MCP servers: ${servers.map((server) => server.label).join(", ") || "none"}`,
					);
					return servers.map((server) => {
						const definition = new vscode.McpStdioServerDefinition(
							server.label,
							server.command,
							server.args,
							server.env,
							server.version,
						);
						if (server.cwd) {
							definition.cwd = vscode.Uri.file(server.cwd);
						}
						return definition;
					});
				},
			},
		);
	} catch (error) {
		// a fork may leave the MCP API out, which must not stop the activation
		logger.info("MCP servers are not available in this VS Code", error);
		changed.dispose();
		return () => {};
	}
	context.subscriptions.push(changed, registration);

	// a reload happens on every save, and when the setting changes: tell VS
	// Code only of a change, such as the setting, another folder, or `--env`
	return () => {
		void currentServers()
			.then((servers) => {
				if (JSON.stringify(servers) !== provided) {
					changed.fire();
				}
			})
			.catch((error) => logger.info("Could not update the MCP servers", error));
	};
}
