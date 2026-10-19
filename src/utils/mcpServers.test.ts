import { describe, expect, it } from "bun:test";
import { buildMcpServers } from "./mcpServers";

describe("buildMcpServers", () => {
	const env = { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1", VSCODE_PID: "42" };
	const mise = { path: "/bin/mise", globalArgs: [], version: "2026.10.14" };
	const pitchfork = { path: "/bin/pitchfork", version: "2.31.0" };

	it("provides the servers enabled, in the folder", () => {
		expect(
			buildMcpServers({
				enabled: ["mise", "pitchfork"],
				folder: "/repo",
				mise,
				pitchfork,
				env,
			}),
		).toEqual([
			{
				label: "mise",
				command: "/bin/mise",
				args: ["--cd", "/repo", "mcp"],
				cwd: "/repo",
				env: { ELECTRON_RUN_AS_NODE: null, VSCODE_PID: null },
				version: "2026.10.14",
			},
			{
				label: "pitchfork",
				command: "/bin/pitchfork",
				args: ["mcp"],
				cwd: "/repo",
				env: { ELECTRON_RUN_AS_NODE: null, VSCODE_PID: null },
				version: "2.31.0",
			},
		]);
	});

	it("passes the environment of mise.miseEnv to mise", () => {
		const [server] = buildMcpServers({
			enabled: ["mise"],
			folder: "/repo",
			mise: { ...mise, globalArgs: ["--env", "dev"] },
			env,
		});
		expect(server?.args).toEqual(["--env", "dev", "--cd", "/repo", "mcp"]);
	});

	it("provides nothing it cannot run", () => {
		expect(
			buildMcpServers({ enabled: [], folder: "/repo", mise, env }),
		).toEqual([]);
		// no pitchfork found
		expect(
			buildMcpServers({ enabled: ["pitchfork"], folder: "/repo", mise, env }),
		).toEqual([]);
		expect(
			buildMcpServers({ enabled: ["mise"], folder: undefined, mise, env }),
		).toEqual([]);
	});
});
