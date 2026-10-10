import { describe, expect, it } from "bun:test";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";
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
}: {
	configFiles: string[];
	taskSources?: string[];
}) {
	const miseService = {
		getCurrentConfigFiles: async () => [...configFiles, ...taskSources],
		getMiseConfigFiles: async () =>
			configFiles.map((path) => ({ path, tools: [] })),
		getAllCachedTasks: async () => [],
		hasMissingTools: async () => false,
		subscribeToTaskCacheEvent: () => {},
		subscribeToReloadEvent: () => {},
		subscribeToRetainedStateDropped: () => {},
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
});
