import { describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import { collectLocalIncludes, getLocalIncludePaths } from "./configIncludes";

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
	});

	it("accepts a single include and paths under the home directory", () => {
		expect(
			getLocalIncludePaths(configPath, { include: "shared.toml" }),
		).toEqual([path.join(project, "shared.toml")]);
		expect(
			getLocalIncludePaths(configPath, { include: ["~/mise/base.toml"] }),
		).toEqual([path.join(os.homedir(), "mise", "base.toml")]);
	});

	it("leaves out the remote and templated includes", () => {
		expect(
			getLocalIncludePaths(configPath, {
				include: [
					"git::https://github.com/acme/mise-config//base.toml?ref=v1",
					"oci::ghcr.io/acme/mise-config:1",
					"{{ vars.shared }}/mise.toml",
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

describe("collectLocalIncludes", () => {
	const configs: Record<string, unknown> = {
		[configPath]: { include: ["shared.toml", "base.toml"] },
		[path.join(project, "shared.toml")]: { include: ["base.toml"] },
		[path.join(project, "base.toml")]: { include: ["mise.toml"] },
	};
	const readConfig = async (filePath: string) => configs[filePath];

	it("follows the includes of included files, each file once", async () => {
		expect(await collectLocalIncludes([configPath], readConfig)).toEqual([
			path.join(project, "shared.toml"),
			path.join(project, "base.toml"),
		]);
	});

	it("skips the files that cannot be read", async () => {
		expect(
			await collectLocalIncludes([configPath], async (filePath) =>
				filePath === configPath ? configs[configPath] : undefined,
			),
		).toEqual([
			path.join(project, "shared.toml"),
			path.join(project, "base.toml"),
		]);
	});
});
