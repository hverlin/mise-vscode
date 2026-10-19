import * as vscode from "vscode";
import { CONFIGURATION_FLAGS, getMcpServers } from "../configuration";
import type { DaemonsService } from "../daemonsService";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import { buildMcpServers } from "../utils/mcpServers";

/** The id of `contributes.mcpServerDefinitionProviders` in package.json */
export const MCP_PROVIDER_ID = "mise.mcpServers";

/** The MCP API of VS Code 1.101+, which the types of the engine predate */
type McpStdioServerDefinition = {
	cwd?: vscode.Uri;
};
type McpApi = {
	lm?: {
		registerMcpServerDefinitionProvider?: (
			id: string,
			provider: {
				onDidChangeMcpServerDefinitions?: vscode.Event<void>;
				provideMcpServerDefinitions: () => Promise<McpStdioServerDefinition[]>;
			},
		) => vscode.Disposable;
	};
	McpStdioServerDefinition?: new (
		label: string,
		command: string,
		args?: string[],
		env?: Record<string, string | number | null>,
		version?: string,
	) => McpStdioServerDefinition;
};

/**
 * Provides `mise mcp` and `pitchfork mcp` to the agents of VS Code, as enabled
 * in `mise.mcpServers`, in the current workspace folder. Nothing on a VS Code
 * without the MCP API (before 1.101).
 *
 * @returns what to call when the servers may have changed: a reload, a folder
 * switch
 */
export function registerMcpServers(
	context: vscode.ExtensionContext,
	miseService: MiseService,
	daemonsService: DaemonsService,
): () => void {
	const api = vscode as unknown as McpApi;
	const Definition = api.McpStdioServerDefinition;
	const register = api.lm?.registerMcpServerDefinitionProvider;
	if (!register || !Definition) {
		return () => {};
	}

	/** the servers enabled that can run, in the current folder */
	const currentServers = async () => {
		const enabled = getMcpServers();
		if (!enabled.length || !vscode.workspace.isTrusted) {
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
				misePath && enabled.includes("mise")
					? {
							path: misePath,
							globalArgs: miseService.buildMiseArgs([]),
							version: await miseService.getVersion(),
						}
					: undefined,
			pitchfork: pitchfork?.supported
				? { path: pitchfork.path, version: pitchfork.version.join(".") }
				: undefined,
		});
	};
	let provided = "[]";

	const changed = new vscode.EventEmitter<void>();
	context.subscriptions.push(
		changed,
		register(MCP_PROVIDER_ID, {
			onDidChangeMcpServerDefinitions: changed.event,
			provideMcpServerDefinitions: async () => {
				const servers = await currentServers();
				provided = JSON.stringify(servers);
				logger.info(
					`MCP servers: ${servers.map((server) => server.label).join(", ") || "none"}`,
				);
				return servers.map((server) => {
					const definition = new Definition(
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
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (
				event.affectsConfiguration(`mise.${CONFIGURATION_FLAGS.mcpServers}`)
			) {
				changed.fire();
			}
		}),
	);
	// a reload happens on every save: tell VS Code only of a change, such as
	// another folder, mise version, or `--env`
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
