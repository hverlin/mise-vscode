import { isEditorEnvKey, isVersionAtLeast } from "./daemons";

/** The MCP servers the extension can provide to the agents of VS Code */
export const MCP_SERVERS = ["mise", "pitchfork"] as const;
export type McpServerName = (typeof MCP_SERVERS)[number];

/** What VS Code needs to start a server over stdio */
export type McpServerSpec = {
	label: string;
	command: string;
	args: string[];
	cwd?: string;
	/** merged into the environment of the extension host, `null` removes */
	env: Record<string, string | null>;
	/** a change restarts the server */
	version?: string;
};

/**
 * The variables VS Code sets for its own processes, which a server must not
 * pass on: pitchfork may start its supervisor from the server, and the
 * supervisor and its daemons would keep them (`ELECTRON_RUN_AS_NODE`, ...).
 */
function withoutEditorEnv(env: NodeJS.ProcessEnv): Record<string, null> {
	return Object.fromEntries(
		Object.keys(env)
			.filter(isEditorEnvKey)
			.map((key) => [key, null]),
	);
}

/** `pitchfork mcp --local` keeps the server to the project, since 2.32.0 */
const MIN_PITCHFORK_VERSION_FOR_LOCAL_MCP = [2, 32, 0] as const;

/**
 * The servers enabled in `mise.mcpServers` that can run: `mise mcp` for the
 * project's tools, tasks, environment and config, and `pitchfork mcp` for its
 * daemons, both started in the current workspace folder.
 */
export function buildMcpServers({
	enabled,
	folder,
	mise,
	pitchfork,
	env = process.env,
}: {
	enabled: readonly string[];
	folder: string | undefined;
	/** `globalArgs`: what mise gets before its command, e.g. `--env dev` */
	mise?: { path: string; globalArgs: string[]; version?: string };
	pitchfork?: { path: string; version: [number, number, number] };
	env?: NodeJS.ProcessEnv;
}): McpServerSpec[] {
	const servers: McpServerSpec[] = [];
	if (!folder) {
		return servers;
	}
	if (enabled.includes("mise") && mise) {
		servers.push({
			label: "mise",
			command: mise.path,
			// mise reads the project of `--cd`, whatever the working directory
			args: [...mise.globalArgs, "--cd", folder, "mcp"],
			cwd: folder,
			env: withoutEditorEnv(env),
			version: mise.version,
		});
	}
	if (enabled.includes("pitchfork") && pitchfork) {
		servers.push({
			label: "pitchfork",
			command: pitchfork.path,
			// before, it reaches the daemons of every project of the machine
			args: isVersionAtLeast(
				pitchfork.version,
				MIN_PITCHFORK_VERSION_FOR_LOCAL_MCP,
			)
				? ["mcp", "--local"]
				: ["mcp"],
			cwd: folder,
			env: withoutEditorEnv(env),
			version: pitchfork.version.join("."),
		});
	}
	return servers;
}
