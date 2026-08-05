import { describe, expect, it } from "bun:test";
import {
	getWebsiteForTool,
	isMiseConfigParseError,
	parseMiseError,
	renderDepsArray,
	toWebUrl,
} from "./miseUtilts";

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

// the `http` backend hands its `url` tool option straight back
const httpToolInfo = (url: string) => ({
	...hkToolInfo,
	backend: "http:some-tool",
	tool_options: { os: null, install_env: {}, url },
});

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

	// the `http` backend returns its `url` tool option verbatim, and tool
	// options are written in the repository's own configuration files
	it("drops a non-web url coming from the http backend tool options", async () => {
		for (const url of [
			"file:///etc/passwd",
			"vscode://ms-vscode.node-debug/launch",
			"javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
		]) {
			expect(await getWebsiteForTool(httpToolInfo(url))).toBeUndefined();
		}
	});

	it("keeps a web url coming from the http backend tool options", async () => {
		const result = await getWebsiteForTool(
			httpToolInfo("https://example.com/tool"),
		);
		expect(result).toBe("https://example.com/tool");
	});
});

describe("toWebUrl", () => {
	it("defaults a scheme-less value to https", () => {
		expect(toWebUrl("github.com/owner/repo")).toBe(
			"https://github.com/owner/repo",
		);
	});

	it("normalizes the git forms used by pipx and asdf backends", () => {
		expect(toWebUrl("git+https://github.com/owner/repo")).toBe(
			"https://github.com/owner/repo",
		);
		expect(toWebUrl("git://github.com/owner/repo")).toBe(
			"https://github.com/owner/repo",
		);
	});

	it("rejects every non-web scheme", () => {
		expect(toWebUrl("file:///etc/passwd")).toBeUndefined();
		expect(toWebUrl("ftp://example.com/x")).toBeUndefined();
		expect(toWebUrl("vscode://ms-vscode.node-debug/launch")).toBeUndefined();
		expect(toWebUrl("javascript:alert(1)")).toBeUndefined();
		expect(toWebUrl("")).toBeUndefined();
		expect(toWebUrl(undefined)).toBeUndefined();
	});
});

describe("renderDepsArray", () => {
	it("renders string, array, and provider-suggested object entries", () => {
		expect(
			renderDepsArray([
				"build",
				["lint", "--fix"],
				{ task: "//projects/ui:build", optional: true },
				{ task: "//projects/api:build" },
			]),
		).toBe(
			"build, lint --fix, //projects/ui:build (optional), //projects/api:build",
		);
	});

	it("returns an empty string without deps", () => {
		expect(renderDepsArray(undefined)).toBe("");
	});
});

describe("isMiseConfigParseError", () => {
	// captured from mise 2026.8.2 while a config file was being edited
	const failed = (stderr: string) =>
		new Error(`Command failed: mise tasks ls --json\n${stderr}`);

	it("recognises a config file that does not parse", () => {
		expect(
			isMiseConfigParseError(
				failed(
					"Error loading settings file: TOML parse error at line 3, column 5\n  |\n3 | [boo\n  |     ^\nunclosed table, expected `]`",
				),
			),
		).toBe(true);
		expect(
			isMiseConfigParseError(
				failed("mise ERROR error parsing config file: /repo/mise.toml"),
			),
		).toBe(true);
		expect(
			isMiseConfigParseError(
				failed("× Invalid TOML in config file: /repo/mise.toml"),
			),
		).toBe(true);
	});

	it("does not swallow the failures that are worth reporting", () => {
		// a stale result must never hide these: they do not fix themselves when
		// the next keystroke lands
		expect(
			isMiseConfigParseError(
				failed("Config files in /repo are not trusted. Trust them with"),
			),
		).toBe(false);
		expect(isMiseConfigParseError(failed("No such file or directory"))).toBe(
			false,
		);
		expect(isMiseConfigParseError(failed("error: unknown flag --nope"))).toBe(
			false,
		);
		expect(isMiseConfigParseError(undefined)).toBe(false);
		expect(isMiseConfigParseError("some string")).toBe(false);
	});
});

describe("parseMiseError", () => {
	// captured from mise 2026.8.2
	const failed = (stderr: string) =>
		new Error(`Command failed: mise tasks ls --json\n${stderr}`);

	it("reads the position and reason out of a located parse error", () => {
		const parsed = parseMiseError(
			failed(`mise::config::parse_error

  × Invalid TOML in config file: /Users/me/projects/demo/mise.toml
   ╭─[/Users/me/projects/demo/mise.toml:5:45]
 4 │ [tasks."slides:build"]
 5 │ description = "Compile the slide deck to PDF
   ·                                             ▲
   ·                                             ╰── invalid basic string, expected \`"\`
   ╰────`),
		);

		expect(parsed.kind).toBe("parse");
		expect(parsed.file).toBe("/Users/me/projects/demo/mise.toml");
		expect(parsed.line).toBe(5);
		expect(parsed.column).toBe(45);
		expect(parsed.reason).toBe('invalid basic string, expected `"`');
	});

	it("reads the position and reason when mise does not name the file", () => {
		const parsed = parseMiseError(
			failed(`Error loading settings file: TOML parse error at line 2, column 20
  |
2 | description = "oops
  |                    ^
invalid basic string, expected \`"\``),
		);

		expect(parsed.kind).toBe("parse");
		expect(parsed.file).toBeUndefined();
		expect(parsed.line).toBe(2);
		expect(parsed.column).toBe(20);
		expect(parsed.reason).toBe('invalid basic string, expected `"`');
	});

	it("reads a bad config value with the key it belongs to", () => {
		const parsed = parseMiseError(
			failed(`Error loading settings file: invalid type: string "not-a-number", expected usize
in \`settings.jobs\``),
		);

		expect(parsed.kind).toBe("settings");
		expect(parsed.reason).toBe(
			'invalid type: string "not-a-number", expected usize (settings.jobs)',
		);
	});

	it("does not mistake the box border for the reason", () => {
		// `╰────` closes the snippet box and used to be read as the reason,
		// which showed up in the sidebar as a row of dashes
		const parsed = parseMiseError(
			failed(`mise::config::parse_error

  × Invalid TOML in config file: ~/projects/demo/mise.toml
   ╭─[~/projects/demo/mise.toml:23:1]
 22 │ run = "echo hi"
 23 │ [tasks.
    ·        ▲
    ·        ╰── invalid table header, expected \`]\`
   ╰────`),
		);

		expect(parsed.reason).toBe("invalid table header, expected `]`");
		expect(parsed.line).toBe(23);
		// mise abbreviates the home directory, the caller has to expand it
		expect(parsed.file).toBe("~/projects/demo/mise.toml");
	});

	it("gives up rather than guessing", () => {
		// the views fall back to their generic message for these
		expect(parseMiseError(failed("No such file or directory")).kind).toBe(
			"unknown",
		);
		expect(parseMiseError(undefined).kind).toBe("unknown");
	});
});
