import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	buildProjectsData,
	configsFromLsAllSources,
	findMiseConfigsInDir,
	formatToolVersion,
	getProjectRootFromConfigPath,
	isMiseNativeConfigPath,
	type MiseConfigWithTools,
	parseToolVersionsContent,
} from "./projectsUtils";

const buildProjectEntries = (
	configs: MiseConfigWithTools[],
	opts?: Parameters<typeof buildProjectsData>[1],
) => buildProjectsData(configs, opts).projects;

describe("isMiseNativeConfigPath", () => {
	it("matches mise config files", () => {
		expect(isMiseNativeConfigPath("/p/mise.toml")).toBe(true);
		expect(isMiseNativeConfigPath("/p/.mise.toml")).toBe(true);
		expect(isMiseNativeConfigPath("/p/mise.local.toml")).toBe(true);
		expect(isMiseNativeConfigPath("/p/mise.macos.toml")).toBe(true);
		expect(isMiseNativeConfigPath("/p/.tool-versions")).toBe(true);
		expect(isMiseNativeConfigPath("/p/mise/config.toml")).toBe(true);
		expect(isMiseNativeConfigPath("/p/.mise/config.local.toml")).toBe(true);
		expect(isMiseNativeConfigPath("/h/.config/mise/config.toml")).toBe(true);
	});

	it("does not match idiomatic or unrelated files", () => {
		expect(isMiseNativeConfigPath("/p/package.json")).toBe(false);
		expect(isMiseNativeConfigPath("/p/.nvmrc")).toBe(false);
		expect(isMiseNativeConfigPath("/p/go.mod")).toBe(false);
		expect(isMiseNativeConfigPath("/p/Cargo.toml")).toBe(false);
		expect(isMiseNativeConfigPath("/p/config.toml")).toBe(false);
	});
});

describe("getProjectRootFromConfigPath", () => {
	it("uses the config directory for top-level configs", () => {
		expect(getProjectRootFromConfigPath("/p/app/mise.toml")).toBe("/p/app");
		expect(getProjectRootFromConfigPath("/p/app/.tool-versions")).toBe(
			"/p/app",
		);
	});

	it("resolves nested mise directories to the project root", () => {
		expect(getProjectRootFromConfigPath("/p/app/mise/config.toml")).toBe(
			"/p/app",
		);
		expect(getProjectRootFromConfigPath("/p/app/.mise/config.toml")).toBe(
			"/p/app",
		);
		expect(
			getProjectRootFromConfigPath("/home/user/.config/mise/config.toml"),
		).toBe("/home/user");
	});
});

describe("formatToolVersion", () => {
	it("formats the tool version shapes found in configs", () => {
		expect(formatToolVersion("20.1.0")).toBe("20.1.0");
		expect(formatToolVersion(["20", "22"])).toBe("20, 22");
		expect(formatToolVersion({ version: "3.12" })).toBe("3.12");
	});
});

describe("parseToolVersionsContent", () => {
	it("parses tool-versions lines and ignores comments", () => {
		expect(
			parseToolVersionsContent(
				"node 20.1.0\n# a comment\nruby 3.3 # inline\n\npython 3.12 3.13\n",
			),
		).toEqual({
			node: "20.1.0",
			ruby: "3.3",
			python: "3.12 3.13",
		});
	});
});

describe("configsFromLsAllSources", () => {
	it("regroups mise ls --all-sources output by config file", () => {
		const configs = configsFromLsAllSources({
			node: [
				{
					version: "22.1.0",
					installed: true,
					sources: [
						{
							type: "mise.toml",
							path: "/p/app/mise.toml",
							requested_version: "22",
						},
					],
				},
				{
					version: "20.0.0",
					installed: false,
					sources: [
						{
							type: ".tool-versions",
							path: "/p/other/.tool-versions",
							requested_version: "20.0.0",
						},
					],
				},
			],
			jq: [
				{
					version: "1.7.1",
					installed: true,
					sources: [
						{
							type: "mise.toml",
							path: "/p/app/mise.toml",
							requested_version: "latest",
						},
					],
				},
			],
		});

		expect(configs).toEqual([
			{
				path: "/p/app/mise.toml",
				tools: {
					node: { version: "22", resolvedVersion: "22.1.0", installed: true },
					jq: { version: "latest", resolvedVersion: "1.7.1", installed: true },
				},
			},
			{
				path: "/p/other/.tool-versions",
				tools: {
					node: {
						version: "20.0.0",
						resolvedVersion: "20.0.0",
						installed: false,
					},
				},
			},
		]);
	});

	it("feeds into buildProjectEntries with details preserved", () => {
		const entries = buildProjectEntries(
			configsFromLsAllSources({
				node: [
					{
						version: "22.1.0",
						installed: false,
						sources: [
							{
								type: "mise.toml",
								path: "/p/app/mise.toml",
								requested_version: "22",
							},
						],
					},
				],
			}),
			{ homeDir: "/home/user" },
		);
		expect(entries[0]?.tools[0]).toMatchObject({
			name: "node",
			version: "22",
			resolvedVersion: "22.1.0",
			installed: false,
		});
	});
});

describe("buildProjectEntries", () => {
	const homeDir = "/home/user";
	const globalConfig = {
		path: "/home/user/.config/mise/config.toml",
		tools: { node: "20", jq: "latest" },
	};

	it("groups configs by project and flags global overrides", () => {
		const entries = buildProjectEntries(
			[
				globalConfig,
				{ path: "/p/app/mise.toml", tools: { node: "22", bun: "1.2.0" } },
				{ path: "/p/other/mise.toml", tools: { jq: "latest" } },
			],
			{ homeDir },
		);

		expect(entries.map((e) => e.rootDir)).toEqual(["/p/app", "/p/other"]);

		const [app, other] = entries;
		expect(app?.tools).toEqual([
			{
				name: "bun",
				version: "1.2.0",
				source: "/p/app/mise.toml",
				idiomatic: false,
				globalVersion: undefined,
				overridesGlobal: false,
			},
			{
				name: "node",
				version: "22",
				source: "/p/app/mise.toml",
				idiomatic: false,
				globalVersion: "20",
				overridesGlobal: true,
			},
		]);
		// same version as the global default: not an override
		expect(other?.tools[0]?.overridesGlobal).toBe(false);
		expect(other?.tools[0]?.globalVersion).toBe("latest");
	});

	it("does not list the global config as a project", () => {
		const entries = buildProjectEntries([globalConfig], { homeDir });
		expect(entries).toEqual([]);
	});

	it("honours an explicitly provided global config path", () => {
		const entries = buildProjectEntries(
			[
				{ path: "/custom/global.toml", tools: { node: "20" } },
				{ path: "/p/app/mise.toml", tools: { node: "22" } },
			],
			{ homeDir, globalConfigPaths: ["/custom/global.toml"] },
		);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.tools[0]?.overridesGlobal).toBe(true);
	});

	it("merges multiple configs of one project, local config last", () => {
		const entries = buildProjectEntries(
			[
				{ path: "/p/app/mise.local.toml", tools: { node: "23" } },
				{ path: "/p/app/mise.toml", tools: { node: "22", bun: "1.2.0" } },
			],
			{ homeDir },
		);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.configs.map((c) => path.basename(c.path))).toEqual([
			"mise.toml",
			"mise.local.toml",
		]);
		expect(entries[0]?.tools.find((t) => t.name === "node")?.version).toBe(
			"23",
		);
	});

	it("returns a flat per-file list including the global config", () => {
		const { configFiles } = buildProjectsData(
			[
				{ path: "/p/app/mise.toml", tools: { node: "22" } },
				{
					path: "/p/app/.nvmrc",
					tools: {
						node: { version: "22", resolvedVersion: "22.1.0" },
					},
				},
				globalConfig,
			],
			{ homeDir },
		);

		expect(configFiles).toEqual([
			{
				path: "/home/user/.config/mise/config.toml",
				idiomatic: false,
				global: true,
				tools: { node: "20", jq: "latest" },
			},
			{
				path: "/p/app/.nvmrc",
				idiomatic: true,
				global: false,
				tools: { node: "22" },
			},
			{
				path: "/p/app/mise.toml",
				idiomatic: false,
				global: false,
				tools: { node: "22" },
			},
		]);
	});

	it("marks idiomatic files and idiomatic-only projects", () => {
		const entries = buildProjectEntries(
			[
				{ path: "/p/app/.nvmrc", tools: { node: "20" } },
				{ path: "/p/full/mise.toml", tools: { node: "22" } },
				{ path: "/p/full/.nvmrc", tools: { node: "22" } },
			],
			{ homeDir },
		);

		const idiomaticOnly = entries.find((e) => e.rootDir === "/p/app");
		expect(idiomaticOnly?.hasMiseConfig).toBe(false);
		expect(idiomaticOnly?.tools[0]?.idiomatic).toBe(true);

		const full = entries.find((e) => e.rootDir === "/p/full");
		expect(full?.hasMiseConfig).toBe(true);
		// the mise config wins over the idiomatic file
		expect(full?.tools[0]?.idiomatic).toBe(false);
	});
});

describe("findMiseConfigsInDir", () => {
	let baseDir: string;

	beforeAll(async () => {
		baseDir = await mkdtemp(path.join(tmpdir(), "mise-projects-test-"));
		await mkdir(path.join(baseDir, "app"), { recursive: true });
		await writeFile(path.join(baseDir, "app", "mise.toml"), "");
		await writeFile(path.join(baseDir, "app", "package.json"), "{}");
		await mkdir(path.join(baseDir, "nested", "lib", ".mise"), {
			recursive: true,
		});
		await writeFile(
			path.join(baseDir, "nested", "lib", ".mise", "config.toml"),
			"",
		);
		await writeFile(path.join(baseDir, "nested", ".tool-versions"), "");
		await mkdir(path.join(baseDir, "app", "node_modules", "dep"), {
			recursive: true,
		});
		await writeFile(
			path.join(baseDir, "app", "node_modules", "dep", "mise.toml"),
			"",
		);
		await mkdir(path.join(baseDir, "deep", "a", "b", "c", "d", "e"), {
			recursive: true,
		});
		await writeFile(
			path.join(baseDir, "deep", "a", "b", "c", "d", "e", "mise.toml"),
			"",
		);
	});

	afterAll(async () => {
		await rm(baseDir, { recursive: true, force: true });
	});

	it("finds mise configs recursively, skipping node_modules", async () => {
		const found = await findMiseConfigsInDir(baseDir);
		expect(found).toEqual([
			path.join(baseDir, "app", "mise.toml"),
			path.join(baseDir, "nested", ".tool-versions"),
			path.join(baseDir, "nested", "lib", ".mise", "config.toml"),
		]);
	});

	it("respects maxDepth", async () => {
		const found = await findMiseConfigsInDir(baseDir, { maxDepth: 10 });
		expect(found).toContain(
			path.join(baseDir, "deep", "a", "b", "c", "d", "e", "mise.toml"),
		);
	});

	it("returns an empty list for a missing directory", async () => {
		expect(await findMiseConfigsInDir(path.join(baseDir, "missing"))).toEqual(
			[],
		);
	});
});
