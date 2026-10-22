import { afterEach, describe, expect, it } from "bun:test";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import { refreshToolInfoInVisibleEditors } from "./inlineToolDecorator";

type FakeDecorationType = {
	options: vscode.DecorationRenderOptions;
	disposed: boolean;
	dispose: () => void;
};

const window = vscode.window as unknown as Record<string, unknown>;
const commands = vscode.commands as unknown as Record<string, unknown>;
const originalExecuteCommand = commands.executeCommand;

afterEach(() => {
	delete window.visibleTextEditors;
	delete window.activeTextEditor;
	delete window.activeColorTheme;
	delete window.createTextEditorDecorationType;
	commands.executeCommand = originalExecuteCommand;
});

// the decorations are kept per document: one folder per test
let folderCount = 0;
const newPath = (fileName = "mise.toml") =>
	`/repo/${folderCount++}/${fileName}`;

function createDocument(
	text: string,
	{ fsPath = newPath(), scheme = "file" } = {},
) {
	const lines = text.split("\n");
	return {
		fileName: fsPath,
		languageId: fsPath.endsWith(".toml") ? "toml" : "plaintext",
		// the left side of a diff has the path of the file, in another scheme
		uri:
			scheme === "file"
				? vscode.Uri.file(fsPath)
				: { fsPath, scheme, toString: () => `${scheme}:${fsPath}?HEAD` },
		version: 1,
		getText: () => text,
		lineCount: lines.length,
		lineAt: (line: number) => ({ text: lines[line] }),
	} as unknown as vscode.TextDocument;
}

function createEditor(document: vscode.TextDocument) {
	const decorations = new Map<FakeDecorationType, vscode.DecorationOptions[]>();
	// what VS Code draws: disposing a type removes its decorations
	const drawn = () => [...decorations].filter(([type]) => !type.disposed);
	return {
		editor: {
			document,
			setDecorations: (
				type: FakeDecorationType,
				options: vscode.DecorationOptions[],
			) => decorations.set(type, options),
		},
		inline: () =>
			drawn()
				.filter(([type]) => type.options.after)
				.flatMap(([, options]) =>
					options.map(
						(o) =>
							`${o.range.start.line}: ${o.renderOptions?.after?.contentText}`,
					),
				),
		gutter: () =>
			drawn()
				.filter(([type]) => type.options.gutterIconPath)
				.flatMap(([type, options]) =>
					options.map((o) => ({
						line: o.range.start.line,
						icon: String(type.options.gutterIconPath),
					})),
				),
	};
}

function setUp({
	visible,
	active,
}: {
	visible: { document: vscode.TextDocument }[];
	active: { document: vscode.TextDocument };
}) {
	window.visibleTextEditors = visible;
	window.activeTextEditor = active;
	window.activeColorTheme = { kind: 2 };
	window.createTextEditorDecorationType = (
		options: vscode.DecorationRenderOptions,
	): FakeDecorationType => {
		const type = {
			options,
			disposed: false,
			dispose: () => {
				type.disposed = true;
			},
		};
		return type;
	};
	const contexts: unknown[][] = [];
	commands.executeCommand = async (...args: unknown[]) => {
		contexts.push(args);
	};
	return { contexts };
}

function createMiseService(
	configFiles: string[],
	state: { tools: MiseTool[]; outdated: MiseToolUpdate[] },
) {
	return {
		getCurrentConfigFiles: async () => configFiles,
		getCurrentTools: async () => state.tools,
		getOutdatedTools: async () => state.outdated,
		getEnvWithInfo: async () => [],
		miseToolInfo: async () => undefined,
	} as unknown as MiseService;
}

const python = (version: string, installed: boolean): MiseTool => ({
	name: "python",
	version,
	requested_version: "3.13",
	installed,
	active: true,
	install_path: "",
});

const node: MiseTool = {
	name: "node",
	version: "22.1.0",
	requested_version: "22",
	installed: true,
	active: true,
	install_path: "",
};

/** `mise outdated` lists a missing tool without a version */
const pythonUpdate = (version: string): MiseToolUpdate => ({
	name: "python",
	version,
	requested_version: "3.13",
	latest: "3.13.17",
});

const context = {} as vscode.ExtensionContext;

describe("refreshToolInfoInVisibleEditors", () => {
	it("redraws a tool installed since, without the document being edited", async () => {
		const document = createDocument('[tools]\npython = "3.13"');
		const toml = createEditor(document);
		const { contexts } = setUp({ visible: [toml.editor], active: toml.editor });
		const state = {
			tools: [python("3.13", false)],
			outdated: [pythonUpdate("")],
		};
		const miseService = createMiseService([document.fileName], state);

		await refreshToolInfoInVisibleEditors(miseService, context);
		expect(toml.inline()).toEqual(["1: \t\t# Not installed"]);
		expect(toml.gutter().map((g) => g.line)).toEqual([1]);
		// the line number menu offers to install it
		expect(contexts.at(-1)).toEqual([
			"setContext",
			"mise.linesWithOutdatedTools",
			[2],
		]);

		// `mise install`, then the reload
		state.tools = [python("3.13.17", true)];
		state.outdated = [];
		await refreshToolInfoInVisibleEditors(miseService, context);
		expect(toml.inline()).toEqual(["1: \t\t# 3.13.17"]);
		expect(toml.gutter()).toEqual([]);
		expect(contexts.at(-1)).toEqual([
			"setContext",
			"mise.linesWithOutdatedTools",
			[],
		]);
	});

	it("draws on the visible editors that are not the active one", async () => {
		const document = createDocument('[tools]\npython = "3.13"');
		const toml = createEditor(document);
		const other = createEditor(createDocument("", { fsPath: newPath("a.ts") }));
		const { contexts } = setUp({
			visible: [toml.editor, other.editor],
			active: other.editor,
		});
		const miseService = createMiseService([document.fileName], {
			tools: [python("3.13.17", true)],
			outdated: [],
		});

		await refreshToolInfoInVisibleEditors(miseService, context);
		expect(toml.inline()).toEqual(["1: \t\t# 3.13.17"]);
		expect(other.inline()).toEqual([]);
		// the line number menu is the active editor's
		expect(contexts).toEqual([]);
	});

	it("swaps the warning for the update icon once a missing tool is installed", async () => {
		const document = createDocument('[tools]\npython = "3.13"');
		const toml = createEditor(document);
		setUp({ visible: [toml.editor], active: toml.editor });
		const state = {
			tools: [python("3.13", false)],
			outdated: [pythonUpdate("")],
		};
		const miseService = createMiseService([document.fileName], state);

		await refreshToolInfoInVisibleEditors(miseService, context);
		const missing = toml.gutter();

		state.tools = [python("3.13.10", true)];
		state.outdated = [pythonUpdate("3.13.10")];
		await refreshToolInfoInVisibleEditors(miseService, context);
		const outdated = toml.gutter();
		expect(outdated.map((g) => g.line)).toEqual([1]);
		expect(outdated[0]?.icon).not.toBe(missing[0]?.icon);
	});

	it("draws each side of a diff from its own document", async () => {
		const fsPath = newPath();
		const head = createEditor(
			createDocument('[tools]\npython = "3.13"', { fsPath, scheme: "git" }),
		);
		const working = createEditor(
			createDocument('[tools]\nnode = "22"\npython = "3.13"', { fsPath }),
		);
		setUp({ visible: [head.editor, working.editor], active: working.editor });
		const miseService = createMiseService([fsPath], {
			tools: [node, python("3.13.17", true)],
			outdated: [],
		});

		await refreshToolInfoInVisibleEditors(miseService, context);
		expect(head.inline()).toEqual(["1: \t\t# 3.13.17"]);
		expect(working.inline()).toEqual(["1: \t\t# 22.1.0", "2: \t\t# 3.13.17"]);
	});

	it("redraws .tool-versions files", async () => {
		const document = createDocument("python 3.13", {
			fsPath: newPath(".tool-versions"),
		});
		const toolVersions = createEditor(document);
		setUp({ visible: [toolVersions.editor], active: toolVersions.editor });
		const miseService = createMiseService([document.fileName], {
			tools: [python("3.13", false)],
			outdated: [pythonUpdate("")],
		});

		await refreshToolInfoInVisibleEditors(miseService, context);
		expect(toolVersions.inline()).toEqual(["0: \t\t# Not installed"]);
		expect(toolVersions.gutter().map((g) => g.line)).toEqual([0]);
	});
});
