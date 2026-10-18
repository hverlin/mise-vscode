import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
	findToolUpdate,
	formatToolHover,
	formatToolOptions,
	getWebsiteLabel,
	markdownLink,
} from "./toolHover";

describe("markdownLink", () => {
	it("keeps the link whole with brackets in the URL or the text", () => {
		expect(
			markdownLink("v1.0)", "https://github.com/acme/tool/releases/tag/v1.0)"),
		).toBe("[v1\\.0\\)](<https://github.com/acme/tool/releases/tag/v1.0)>)");
		expect(markdownLink("[x]", "https://dart.dev/")).toBe(
			"[\\[x\\]](<https://dart.dev/>)",
		);
	});
});

describe("getWebsiteLabel", () => {
	it("leaves out the scheme and the trailing slash", () => {
		expect(getWebsiteLabel("https://dart.dev/")).toBe("dart.dev");
		expect(getWebsiteLabel("http://github.com/hashicorp/nomad-pack")).toBe(
			"github.com/hashicorp/nomad-pack",
		);
	});
});

describe("findToolUpdate", () => {
	const configPath = path.join(path.sep, "projects", "app", "mise.toml");
	const update: MiseToolUpdate = {
		name: "node",
		version: "24.21.0",
		requested_version: "24",
		latest: "24.22.0",
		release_url: "https://nodejs.org/en/blog/release/v24.22.0",
		source: { type: "mise.toml", path: configPath },
	};

	it("finds the newer version of a tool of the config", () => {
		expect(findToolUpdate([update], "node", configPath)).toEqual(update);
	});

	it("leaves out the tools that are not installed", () => {
		// listed with the requested version as the latest one
		expect(
			findToolUpdate(
				[{ ...update, version: "", latest: "24" }],
				"node",
				configPath,
			),
		).toBeUndefined();
		expect(
			findToolUpdate([{ ...update, latest: "24.21.0" }], "node", configPath),
		).toBeUndefined();
	});

	it("leaves out the version another config requests", () => {
		const globalConfig = path.join(
			path.sep,
			"home",
			"me",
			".config",
			"mise",
			"config.toml",
		);
		expect(findToolUpdate([update], "node", globalConfig)).toBeUndefined();
		expect(
			findToolUpdate([{ ...update, source: undefined }], "node", configPath),
		).toBeUndefined();
		expect(findToolUpdate([update], "python", configPath)).toBeUndefined();
	});
});

describe("formatToolOptions", () => {
	it("lists the options set, as written in a config", () => {
		expect(
			formatToolOptions({
				os: ["linux", "macos"],
				depends: null,
				install_env: { FOO: "bar", "A.B": "c" },
				lazy: true,
				lazy_bins: [],
				auto_update: null,
				postinstall: "echo hi",
			}),
		).toBe(
			[
				'`os = ["linux", "macos"]`',
				'`install_env = { FOO = "bar", "A.B" = "c" }`',
				"`lazy = true`",
				'`postinstall = "echo hi"`',
			].join(", "),
		);
	});

	it("is undefined when no option is set", () => {
		expect(
			formatToolOptions({
				os: null,
				depends: null,
				install_env: {},
				lazy: null,
				lazy_bins: [],
				auto_update: null,
			}),
		).toBeUndefined();
		expect(formatToolOptions(undefined)).toBeUndefined();
	});

	it("keeps an option set to false", () => {
		expect(formatToolOptions({ lazy: false })).toBe("`lazy = false`");
	});
});

describe("formatToolHover", () => {
	const node: MiseToolInfo = {
		backend: "core:node",
		description: null,
		installed_versions: [
			"22.11.0",
			"24.13.0",
			"24.20.0",
			"24.21.0",
			"25.9.0",
			"26.4.0",
			"26.11.1",
		],
		requested_versions: ["24"],
		active_versions: ["24.21.0"],
		config_source: null,
		tool_options: { os: null, install_env: {}, lazy: null },
	};

	it("shows the tool, then a line per detail", () => {
		expect(
			formatToolHover({
				toolName: "node",
				toolInfo: node,
				requestedVersion: "24",
				backendWebsite: "https://github.com/nodejs/node",
				update: {
					name: "node",
					version: "24.21.0",
					requested_version: "24",
					latest: "24.22.0",
					release_url: "https://github.com/nodejs/node/releases/tag/v24.22.0",
				},
			}),
		).toBe(
			[
				"**node** · [core\\:node](<https://github.com/nodejs/node>)",
				"",
				[
					"**Version** 24\\.21\\.0 · requested 24",
					"**Update** 24\\.22\\.0 · [release notes](<https://github.com/nodejs/node/releases/tag/v24.22.0>)",
					"**Installed** 26\\.11\\.1, 26\\.4\\.0, 25\\.9\\.0, 24\\.21\\.0, 24\\.20\\.0 and 2 more",
				].join("  \n"),
			].join("\n"),
		);
	});

	it("adds the description, the website and the options set", () => {
		expect(
			formatToolHover({
				toolName: "dart",
				toolInfo: {
					...node,
					backend: "http:dart",
					description: "The Dart SDK",
					url: "https://dart.dev",
					installed_versions: [],
					requested_versions: ["3"],
					active_versions: [],
					tool_options: { lazy: true, os: ["linux"] },
				},
			}),
		).toBe(
			[
				"**dart** · http\\:dart",
				"",
				"The Dart SDK",
				"",
				[
					"**Version** installs on first use · requested 3",
					"**Website** [dart\\.dev](<https://dart.dev/>)",
					'**Options** `lazy = true`, `os = ["linux"]`',
				].join("  \n"),
			].join("\n"),
		);
	});

	it("does not repeat what the title or the version already says", () => {
		const hover = formatToolHover({
			toolName: "github:cli/cli",
			toolInfo: {
				...node,
				backend: "github:cli/cli",
				installed_versions: ["2.96.0"],
				requested_versions: ["2.96.0"],
				active_versions: ["2.96.0"],
			},
			backendWebsite: "https://github.com/cli/cli",
		});
		expect(hover).toBe(
			[
				"**[github\\:cli\\/cli](<https://github.com/cli/cli>)**",
				"",
				"**Version** 2\\.96\\.0",
			].join("\n"),
		);
	});
});
