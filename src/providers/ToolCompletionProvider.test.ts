import { describe, expect, it } from "bun:test";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import { ToolCompletionProvider } from "./ToolCompletionProvider";

function createDocument(lines: string[]): vscode.TextDocument {
	return {
		fileName: "/project/mise.toml",
		lineAt: (line: number | vscode.Position) => ({
			text: lines[typeof line === "number" ? line : line.line],
		}),
	} as unknown as vscode.TextDocument;
}

function createProvider(versions: string[]) {
	const miseService = {
		miseRegistry: async () => [],
		miseBackends: async () => [],
		miseRegistryDescriptions: async () => new Map(),
		listRemoteVersions: async () => versions,
	} as unknown as MiseService;
	return new ToolCompletionProvider(miseService);
}

describe("ToolCompletionProvider", () => {
	it("lists versions newest first, as VS Code sorts them", async () => {
		// newest first, as `listRemoteVersions` returns them
		const versions = Array.from({ length: 12 }, (_, i) => `2.${11 - i}.0`);
		const line = "deno = ";
		const items = (await createProvider(versions).provideCompletionItems(
			createDocument(["[tools]", line]),
			new vscode.Position(1, line.length),
		)) as vscode.CompletionItem[];

		// VS Code compares `sortText` as text
		const sorted = [...items].sort((a, b) =>
			(a.sortText ?? "") < (b.sortText ?? "") ? -1 : 1,
		);
		expect(sorted.map((item) => item.label)).toEqual(["latest", ...versions]);
	});
});
