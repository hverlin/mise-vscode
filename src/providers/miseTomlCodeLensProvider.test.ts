import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import type { LockfileChange } from "../utils/lockfile";
import { MiseTomlCodeLensProvider } from "./miseTomlCodeLensProvider";

function createDocument(fsPath: string, text: string): vscode.TextDocument {
	return {
		fileName: fsPath,
		uri: vscode.Uri.file(fsPath),
		version: 1,
		getText: () => text,
	} as unknown as vscode.TextDocument;
}

function createProvider({
	configFiles,
	taskSources = [],
	paranoid = false,
	untrustedConfigFiles = [],
	ignoredConfigFiles = [],
	lockfile,
}: {
	configFiles: string[];
	taskSources?: string[];
	paranoid?: boolean;
	untrustedConfigFiles?: string[];
	ignoredConfigFiles?: string[];
	/** what mise reports on the lockfiles; mise is too old without it */
	lockfile?: {
		setting?: boolean;
		changes?: LockfileChange[];
		bumps?: () => Promise<LockfileChange[]>;
	};
}) {
	const miseService = {
		getCurrentConfigFiles: async () => [...configFiles, ...taskSources],
		getMiseConfigFiles: async () =>
			configFiles.map((path) => ({ path, tools: [] })),
		getAllCachedTasks: async () => [],
		hasMissingTools: async () => false,
		isParanoidMode: async () => paranoid,
		untrustedConfigFiles,
		getIgnoredConfigFiles: async () => new Set(ignoredConfigFiles),
		subscribeToTaskCacheEvent: () => {},
		subscribeToReloadEvent: () => {},
		subscribeToRetainedStateDropped: () => {},
		subscribeToUntrustedConfigChange: () => {},
		supportsLockfileLenses: async () => lockfile !== undefined,
		getLockfileSetting: async () => lockfile?.setting,
		getLockfileChanges: async (_root: string, { bump = false } = {}) =>
			bump ? (lockfile?.bumps?.() ?? []) : (lockfile?.changes ?? []),
	} as unknown as MiseService;

	return new MiseTomlCodeLensProvider(miseService);
}

async function getLenses(
	provider: MiseTomlCodeLensProvider,
	document: vscode.TextDocument,
) {
	const lenses = await provider.provideCodeLenses(document);
	return lenses.map((lens) => ({
		line: lens.range.start.line,
		title: lens.command?.title,
		arguments: lens.command?.arguments,
	}));
}

const toolsOnlyConfig = `#:schema https://mise.jdx.dev/schema/mise.json

# ----------------------------------
# TOOLS

[tools]
tombi = "1.2.4"
`;

describe("MiseTomlCodeLensProvider", () => {
	// https://github.com/hverlin/mise-vscode/issues/310
	it.each([
		"/home/user/.config/mise/conf.d/tools.toml",
		"/project/.config/mise/config.local.toml",
		"/project/mise.dev.local.toml",
	])("treats %s as a config file, not as a task file", async (path) => {
		const provider = createProvider({ configFiles: [path] });

		const lenses = await getLenses(
			provider,
			createDocument(path, toolsOnlyConfig),
		);

		expect(lenses.map((lens) => lens.title)).toEqual([
			"$(add) Add tool",
			"$(list-unordered) List tools",
		]);
		expect(lenses.every((lens) => lens.line === 5)).toBe(true);
	});

	it("treats the mise.toml of a monorepo subproject as a config file", async () => {
		// mise lists it as a task source, but not in `mise config ls`
		const path = "/project/projects/frontend/mise.toml";
		const provider = createProvider({
			configFiles: ["/project/mise.toml"],
			taskSources: [path],
		});

		const lenses = await getLenses(
			provider,
			createDocument(path, '[tasks.build]\nrun = "echo build"\n'),
		);

		expect(lenses).toEqual([
			{ line: 0, title: "$(play) Run", arguments: ["build"] },
			{ line: 0, title: "$(eye-watch) Watch", arguments: ["build"] },
		]);
	});

	it("does not add task lenses to comments in a task file", async () => {
		const provider = createProvider({
			configFiles: ["/project/mise.toml"],
			taskSources: ["/project/tasks.toml"],
		});

		const lenses = await getLenses(
			provider,
			createDocument(
				"/project/tasks.toml",
				`# build tasks
build = "echo build"

# lint = "echo lint"
[test]
run = "echo test"
`,
			),
		);

		expect(lenses).toEqual([
			{ line: 1, title: "$(play) Run", arguments: ["build"] },
			{ line: 1, title: "$(eye-watch) Watch", arguments: ["build"] },
			{ line: 4, title: "$(play) Run", arguments: ["test"] },
			{ line: 4, title: "$(eye-watch) Watch", arguments: ["test"] },
		]);
	});

	it("does not add task lenses to comments in a [tasks] section", async () => {
		const provider = createProvider({ configFiles: ["/project/mise.toml"] });

		const lenses = await getLenses(
			provider,
			createDocument(
				"/project/mise.toml",
				`[tasks]
# a comment
build = "echo build"
`,
			),
		);

		expect(lenses).toEqual([
			{ line: 2, title: "$(play) Run", arguments: ["build"] },
			{ line: 2, title: "$(eye-watch) Watch", arguments: ["build"] },
		]);
	});

	it("only offers to review a config file mise refuses", async () => {
		const path = "/project/mise.toml";
		const provider = createProvider({
			configFiles: [path],
			untrustedConfigFiles: [path],
		});

		const lenses = await getLenses(
			provider,
			createDocument(path, '[tasks.build]\nrun = "echo build"\n'),
		);

		expect(lenses).toEqual([
			{
				line: 0,
				title: "$(shield) Not trusted. File not loaded",
				arguments: undefined,
			},
		]);
	});

	it("shows paranoid mode on top of a config file", async () => {
		const path = "/project/mise.toml";
		const provider = createProvider({ configFiles: [path], paranoid: true });

		const lenses = await getLenses(
			provider,
			createDocument(path, '[tasks.build]\nrun = "echo build"\n'),
		);

		expect(lenses.map(({ line, title }) => ({ line, title }))).toEqual([
			{ line: 0, title: "$(shield) Paranoid mode" },
			{ line: 0, title: "Trust my own edits: off" },
			{ line: 0, title: "$(play) Run" },
			{ line: 0, title: "$(eye-watch) Watch" },
		]);
	});

	it("offers to trust a config file the user told mise to ignore", async () => {
		const path = "/project/mise.toml";
		const provider = createProvider({
			configFiles: [path],
			ignoredConfigFiles: [path],
		});

		const lenses = await getLenses(
			provider,
			createDocument(path, '[tasks.build]\nrun = "echo build"\n'),
		);

		expect(lenses).toEqual([
			{
				line: 0,
				title: "$(eye-closed) Ignored by mise. File not loaded",
				arguments: [path],
			},
		]);
	});
});

describe("lockfile lenses", () => {
	let project: string;
	let lockfile: string;
	const workspace = vscode.workspace as unknown as Record<string, unknown>;
	const originalGetWorkspaceFolder = workspace.getWorkspaceFolder;

	beforeAll(async () => {
		project = await mkdtemp(path.join(tmpdir(), "mise-vscode-lock-"));
		lockfile = path.join(project, "mise.lock");
	});
	afterAll(async () => {
		await rm(project, { recursive: true, force: true });
	});
	afterEach(async () => {
		workspace.getWorkspaceFolder = originalGetWorkspaceFolder;
		await rm(lockfile, { force: true });
	});

	const inWorkspace = () => {
		workspace.getWorkspaceFolder = () => ({ uri: vscode.Uri.file(project) });
	};
	const change = (
		name: string,
		oldVersions: string[],
		newVersions: string[],
		file = lockfile,
	): LockfileChange => ({
		name,
		backend: `aqua:${name}`,
		lockfile: file,
		old_versions: oldVersions,
		new_versions: newVersions,
	});

	it("reports a lockfile out of sync, its bumps and an old format", async () => {
		inWorkspace();
		const provider = createProvider({
			configFiles: [path.join(project, "mise.toml")],
			lockfile: {
				changes: [
					change("node", ["24.21.0"], ["22.22.0"]),
					change("yq", [], ["4.52.4"], path.join(project, "mise.local.lock")),
				],
				bumps: async () => [
					change("jq", ["1.7.1"], ["1.8.0"]),
					// added by any `mise lock`, not by the bump
					change("node", [], ["22.22.0"]),
					change("bun", ["1.4.2"], ["1.4.2"]),
				],
			},
		});

		const lenses = await getLenses(
			provider,
			createDocument(lockfile, '[[tools.node]]\nversion = "24.21.0"\n'),
		);
		expect(lenses).toEqual([
			{
				line: 0,
				title: "$(warning) 1 tool out of sync · Update",
				arguments: [{ configRoot: project, flags: [], lockfile }],
			},
			{
				line: 0,
				title: "$(arrow-up) Bump 1 tool",
				arguments: [{ configRoot: project, flags: ["--bump"], lockfile }],
			},
			{
				line: 0,
				title: "$(versions) Upgrade format v0 → v3",
				arguments: [{ configRoot: project, flags: ["--upgrade"], lockfile }],
			},
		]);
	});

	it("says a lockfile in the latest format has every tool", async () => {
		inWorkspace();
		const provider = createProvider({
			configFiles: [path.join(project, "mise.toml")],
			lockfile: { changes: [] },
		});

		const lenses = await getLenses(
			provider,
			createDocument(lockfile, "lockfile_version = 3\n"),
		);
		expect(lenses.map((lens) => lens.title)).toEqual(["$(check) In sync"]);
	});

	it("updates mise.local.lock with --local", async () => {
		inWorkspace();
		const localLockfile = path.join(project, "mise.local.lock");
		const provider = createProvider({
			configFiles: [path.join(project, "mise.local.toml")],
			lockfile: {
				changes: [change("yq", [], ["4.52.4"], localLockfile)],
			},
		});

		const lenses = await getLenses(
			provider,
			createDocument(localLockfile, "lockfile_version = 3\n"),
		);
		expect(lenses).toEqual([
			{
				line: 0,
				title: "$(warning) 1 tool out of sync · Update",
				arguments: [
					{ configRoot: project, flags: ["--local"], lockfile: localLockfile },
				],
			},
		]);
	});

	it("shows nothing when lockfiles are off, outside the workspace, or on an old mise", async () => {
		const document = createDocument(lockfile, "[[tools.node]]\n");
		const configFiles = [path.join(project, "mise.toml")];

		inWorkspace();
		const off = createProvider({
			configFiles,
			lockfile: { setting: false, changes: [] },
		});
		expect(await getLenses(off, document)).toEqual([]);

		const old = createProvider({ configFiles });
		expect(await getLenses(old, document)).toEqual([]);

		workspace.getWorkspaceFolder = originalGetWorkspaceFolder;
		const outside = createProvider({ configFiles, lockfile: {} });
		expect(await getLenses(outside, document)).toEqual([]);
	});

	it("shows nothing on a lockfile no config file loaded writes to", async () => {
		inWorkspace();
		// mise reports on the lockfile of the config root, not on this one
		const stray = createProvider({
			configFiles: [path.join(project, "mise.toml")],
			lockfile: { changes: [] },
		});
		expect(
			await getLenses(
				stray,
				createDocument(path.join(project, "sub", "mise.lock"), ""),
			),
		).toEqual([]);

		// `mise lock --global` updates the lockfile of the global config
		const globalConfig = path.join(os.homedir(), ".config", "mise");
		const global = createProvider({
			configFiles: [path.join(globalConfig, "config.toml")],
			lockfile: { changes: [] },
		});
		expect(
			await getLenses(
				global,
				createDocument(path.join(globalConfig, "mise.lock"), ""),
			),
		).toEqual([]);
	});

	it("adds the bump lens once the newer versions are looked up", async () => {
		inWorkspace();
		let finishBump: (changes: LockfileChange[]) => void = () => {};
		const bump = new Promise<LockfileChange[]>((resolve) => {
			finishBump = resolve;
		});
		const provider = createProvider({
			configFiles: [path.join(project, "mise.toml")],
			lockfile: { changes: [], bumps: () => bump },
		});
		let refreshed = false;
		provider.onDidChangeCodeLenses(() => {
			refreshed = true;
		});
		const document = createDocument(lockfile, "lockfile_version = 3\n");

		const lenses = await getLenses(provider, document);
		expect(lenses.map((lens) => lens.title)).toEqual(["$(check) In sync"]);

		finishBump([change("jq", ["1.7.1"], ["1.8.0"])]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(refreshed).toBe(true);
		expect(
			(await getLenses(provider, document)).map((lens) => lens.title),
		).toEqual(["$(check) In sync", "$(arrow-up) Bump 1 tool"]);
	}, 10_000);

	describe("next to the tools of a config file", () => {
		const configText = '[tools]\nnode = "24"\n';

		it("offers to create the lockfile when mise is set to", async () => {
			inWorkspace();
			const config = path.join(project, "mise.toml");
			const changes = [change("node", [], ["24.21.0"])];

			const create = createProvider({
				configFiles: [config],
				lockfile: { setting: true, changes },
			});
			const lenses = await getLenses(
				create,
				createDocument(config, configText),
			);
			expect(lenses.at(-1)).toEqual({
				line: 0,
				title: "$(lock) Create mise.lock",
				arguments: [{ configRoot: project, flags: [], lockfile }],
			});

			// unset: mise does not create lockfiles
			const unset = createProvider({
				configFiles: [config],
				lockfile: { changes },
			});
			expect(
				(await getLenses(unset, createDocument(config, configText))).map(
					(lens) => lens.title,
				),
			).toEqual(["$(add) Add tool", "$(list-unordered) List tools"]);
		});

		it("reports a lockfile without its tools", async () => {
			inWorkspace();
			await writeFile(lockfile, "lockfile_version = 3\n");
			const config = path.join(project, "mise.toml");
			const provider = createProvider({
				configFiles: [config],
				lockfile: {
					changes: [change("node", ["22.22.0"], ["24.21.0"])],
				},
			});

			const lenses = await getLenses(
				provider,
				createDocument(config, configText),
			);
			expect(lenses.at(-1)).toEqual({
				line: 0,
				title: "$(warning) mise.lock out of date",
				arguments: [{ configRoot: project, flags: [], lockfile }],
			});
		});

		it("leaves out the changes of the lockfile of an environment", async () => {
			inWorkspace();
			await writeFile(lockfile, "lockfile_version = 3\n");
			const config = path.join(project, "mise.toml");
			// MISE_ENV=test, and mise.test.toml also has node
			const provider = createProvider({
				configFiles: [config, path.join(project, "mise.test.toml")],
				lockfile: {
					setting: true,
					changes: [
						change(
							"node",
							[],
							["24.21.0"],
							path.join(project, "mise.test.lock"),
						),
					],
				},
			});

			const lenses = await getLenses(
				provider,
				createDocument(config, configText),
			);
			expect(lenses.map((lens) => lens.title)).toEqual([
				"$(add) Add tool",
				"$(list-unordered) List tools",
			]);
		});
	});
});
