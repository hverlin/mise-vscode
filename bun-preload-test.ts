import { mock } from "bun:test";

mock.module("vscode", () => {
	class Position {
		constructor(
			public line: number,
			public character: number,
		) {}
	}

	class Range {
		constructor(
			public start: Position,
			public end: Position,
		) {}
	}

	class MarkdownString {
		public supportHtml = false;
		constructor(public value = "") {}

		appendMarkdown(markdown: string) {
			this.value += markdown;
			return this;
		}

		appendText(text: string) {
			this.value += text;
			return this;
		}

		appendCodeblock(code: string, language = "") {
			this.value += `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
			return this;
		}
	}

	return {
		workspace: {},
		window: {
			showErrorMessage: () => {},
			showInformationMessage: () => {},
			showQuickPick: () => {},
			showTextDocument: () => {},
			createOutputChannel: () => {},
		},
		ConfigurationTarget: {},
		MarkdownString,
		Position,
		Range: Range,
		Uri: {
			file: (fsPath: string) => ({
				fsPath,
				path: fsPath,
				scheme: "file",
				toString: () => `file://${fsPath}`,
			}),
		},
	};
});
