import { describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import {
	collectLocalIncludes,
	getLocalIncludePaths,
	getMiseRcPaths,
	readIncludeEntries,
} from "./configIncludes";

const project = path.join(path.sep, "projects", "app");
const configPath = path.join(project, "mise.toml");

describe("getLocalIncludePaths", () => {
	it("resolves the local paths from the directory of the config", () => {
		expect(
			getLocalIncludePaths(configPath, {
				include: ["shared.toml", "../common/mise.toml", "/etc/mise/base.toml"],
			}),
		).toEqual([
			path.join(project, "shared.toml"),
			path.join(path.sep, "projects", "common", "mise.toml"),
			path.join(path.sep, "etc", "mise", "base.toml"),
		]);
		expect(
			getLocalIncludePaths(
				path.join(project, ".config", "mise", "config.toml"),
				{
					include: ["shared.toml"],
				},
			),
		).toEqual([path.join(project, ".config", "mise", "shared.toml")]);
	});

	it("accepts a single include and paths under the home directory", () => {
		expect(
			getLocalIncludePaths(configPath, { include: "shared.toml" }),
		).toEqual([path.join(project, "shared.toml")]);
		expect(
			getLocalIncludePaths(configPath, { include: ["~/mise/base.toml"] }),
		).toEqual([path.join(os.homedir(), "mise", "base.toml")]);
	});

	it("renders config_root, the project of the config", () => {
		for (const config of [
			configPath,
			path.join(project, ".config", "mise", "config.toml"),
			path.join(project, "mise", "conf.d", "tools.toml"),
			path.join(project, ".config", "mise.toml"),
		]) {
			expect(
				getLocalIncludePaths(config, {
					include: ["{{ config_root }}/shared.toml", "{{config_root}}/b.toml"],
				}),
			).toEqual([
				path.join(project, "shared.toml"),
				path.join(project, "b.toml"),
			]);
		}
	});

	it("leaves out the remote, templated and non-toml includes", () => {
		expect(
			getLocalIncludePaths(configPath, {
				include: [
					"git::https://github.com/acme/mise-config//base.toml?ref=v1",
					"oci::ghcr.io/acme/mise-config:1",
					"{{ vars.shared }}/mise.toml",
					"{% if true %}a.toml{% endif %}",
					".tool-versions",
					"",
					42,
				],
			}),
		).toEqual([]);
	});

	it("is empty without include", () => {
		expect(getLocalIncludePaths(configPath, { tools: {} })).toEqual([]);
		expect(getLocalIncludePaths(configPath, undefined)).toEqual([]);
	});
});

describe("readIncludeEntries", () => {
	it("reads the top-level include of a config the parser rejects", () => {
		// a multi-line inline table, TOML 1.1
		const source = `include = [
  "shared.toml", 'local.toml',
]
[tools]
node = { version = "24",
  postinstall = "true" }
`;
		expect(readIncludeEntries(source)).toEqual(["shared.toml", "local.toml"]);
		expect(readIncludeEntries('include = "one.toml"\n')).toEqual(["one.toml"]);
	});

	it("ignores the comments, in and around the array", () => {
		const source = `# include = ["old.toml"]
include = [
  "shared.toml", # the shared tools ]
  # "disabled.toml",
  "local.toml", # "#" in a comment
]
`;
		expect(readIncludeEntries(source)).toEqual(["shared.toml", "local.toml"]);
		expect(readIncludeEntries('include = ["a#b.toml"] # c\n')).toEqual([
			"a#b.toml",
		]);
	});

	it("ignores an include key of a table", () => {
		expect(
			readIncludeEntries('[task_config]\ninclude = ["tasks.toml"]\n'),
		).toEqual([]);
	});
});

describe("collectLocalIncludes", () => {
	const configs: Record<string, unknown> = {
		[configPath]: { include: ["shared.toml", "base.toml"] },
		[path.join(project, "mise.local.toml")]: { include: ["base.toml"] },
	};
	const readConfig = async (filePath: string) => configs[filePath];

	it("lists the files the configs include, each once", async () => {
		expect(
			await collectLocalIncludes(
				[configPath, path.join(project, "mise.local.toml"), configPath],
				readConfig,
			),
		).toEqual([
			path.join(project, "shared.toml"),
			path.join(project, "base.toml"),
		]);
	});

	it("skips the files that cannot be read", async () => {
		expect(
			await collectLocalIncludes(
				[configPath, path.join(project, "missing.toml")],
				readConfig,
			),
		).toEqual([
			path.join(project, "shared.toml"),
			path.join(project, "base.toml"),
		]);
	});
});

describe("getMiseRcPaths", () => {
	const home = path.join(path.sep, "home", "me");
	const configDir = path.join(home, ".config", "mise");

	it("walks up to the home directory, then the global and system files", () => {
		expect(
			getMiseRcPaths({
				cwd: path.join(home, "app"),
				home,
				configDir,
				systemConfigDir: path.join(path.sep, "etc", "mise"),
			}),
		).toEqual([
			path.join(home, "app", ".miserc.local.toml"),
			path.join(home, "app", ".miserc.toml"),
			path.join(home, "app", ".config", "miserc.toml"),
			path.join(home, ".miserc.local.toml"),
			path.join(home, ".miserc.toml"),
			path.join(configDir, "miserc.local.toml"),
			path.join(configDir, "miserc.toml"),
			path.join(path.sep, "etc", "mise", "miserc.toml"),
		]);
	});

	it("stops at a ceiling path", () => {
		expect(
			getMiseRcPaths({
				cwd: path.join(home, "app", "web"),
				home,
				configDir,
				ceilingPaths: [`${path.join(home, "app")}${path.sep}`],
			}),
		).toEqual([
			path.join(home, "app", "web", ".miserc.local.toml"),
			path.join(home, "app", "web", ".miserc.toml"),
			path.join(home, "app", "web", ".config", "miserc.toml"),
			path.join(configDir, "miserc.local.toml"),
			path.join(configDir, "miserc.toml"),
		]);
	});
});
