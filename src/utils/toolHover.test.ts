import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
	findToolUpdate,
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
