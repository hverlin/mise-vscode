import { describe, expect, it } from "bun:test";
import { getWebsiteForTool } from "./miseUtilts";

// Mock MiseToolInfo objects matching exact `mise tool X --json` outputs

const nodeToolInfo = {
	backend: "core:node",
	description: null,
	installed_versions: ["22.21.1", "24.11.0", "25.1.0"],
	requested_versions: ["24"],
	active_versions: ["24.11.0"],
	config_source: { type: "mise.toml", path: "/project/mise.toml" },
	tool_options: { os: null, install_env: {} },
};

const pklToolInfo = {
	backend: "aqua:apple/pkl",
	description: "A configuration as code language",
	installed_versions: ["0.29.1", "0.30.0"],
	requested_versions: ["0.29.1"],
	active_versions: ["0.29.1"],
	config_source: { type: "mise.toml", path: "/project/mise.toml" },
	tool_options: { os: null, install_env: {} },
};

// mise tool "github:cli/cli" --json — not installed in current context
const githubCliToolInfo = {
	backend: "github:cli/cli",
	description: null,
	installed_versions: [],
	requested_versions: null,
	active_versions: null,
	config_source: null,
	tool_options: { os: null, install_env: {} },
};

// mise tool "github:cli/cli" --json when it IS configured with a custom api_url
const githubCliWithApiUrl = {
	backend: "github:cli/cli",
	description: null,
	installed_versions: [],
	requested_versions: ["latest"],
	active_versions: null,
	config_source: { type: "mise.toml", path: "/project/mise.toml" },
	tool_options: {
		os: null,
		install_env: {},
		api_url: "https://test.github.com/api/v3",
	},
};

const hkToolInfo = {
	backend: "aqua:jdx/hk",
	description: "A git hook manager",
	installed_versions: [],
	requested_versions: ["1.18.0"],
	active_versions: null,
	config_source: { type: "mise.toml", path: "/project/mise.toml" },
	tool_options: { os: null, install_env: {} },
};

describe("getWebsiteForTool", () => {
	it("returns mise lang page for core:node", async () => {
		const result = await getWebsiteForTool(nodeToolInfo);
		expect(result).toBe("https://mise.jdx.dev/lang/node");
	});

	it("returns GitHub URL for aqua:apple/pkl", async () => {
		const result = await getWebsiteForTool(pklToolInfo);
		expect(result).toBe("https://github.com/apple/pkl");
	});

	it("returns GitHub URL for github:cli/cli (not installed, no api_url)", async () => {
		const result = await getWebsiteForTool(githubCliToolInfo);
		expect(result).toBe("https://github.com/cli/cli");
	});

	it("returns GitHub URL for github:cli/cli with api_url pointing to api endpoint", async () => {
		const result = await getWebsiteForTool(githubCliWithApiUrl);
		expect(result).toBe("https://test.github.com/cli/cli");
	});

	it("returns GitHub URL for aqua:jdx/hk", async () => {
		const result = await getWebsiteForTool(hkToolInfo);
		expect(result).toBe("https://github.com/jdx/hk");
	});

	it("returns undefined when backend is missing", async () => {
		// @ts-expect-error intentional bad input
		const result = await getWebsiteForTool({ backend: null });
		expect(result).toBeUndefined();
	});

	it("returns undefined when backend has no colon (unknown backend)", async () => {
		// @ts-expect-error intentional
		const result = await getWebsiteForTool({ backend: "unknown" });
		expect(result).toBeUndefined();
	});
});
