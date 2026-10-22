import { mock } from "bun:test";

mock.module("vscode", () => {
	class Position {
		constructor(
			public line: number,
			public character: number,
		) {}

		translate(lineDelta = 0, characterDelta = 0) {
			return new Position(
				this.line + lineDelta,
				this.character + characterDelta,
			);
		}
	}

	class Range {
		public start: Position;
		public end: Position;
		// like vscode, also `new Range(startLine, startCharacter, endLine, endCharacter)`
		constructor(
			start: Position | number,
			end: Position | number,
			endLine = 0,
			endCharacter = 0,
		) {
			this.start =
				typeof start === "number" ? new Position(start, end as number) : start;
			this.end =
				typeof start === "number"
					? new Position(endLine, endCharacter)
					: (end as Position);
		}
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

	class CompletionItem {
		sortText?: string;
		insertText?: string;
		range?: Range;
		constructor(
			public label: string | { label: string; description?: string },
			public kind?: number,
		) {}
	}

	class CodeLens {
		constructor(
			public range: Range,
			public command?: {
				title: string;
				command: string;
				arguments?: unknown[];
			},
		) {}
	}

	class EventEmitter<T> {
		private listeners: ((value: T) => void)[] = [];
		event = (listener: (value: T) => void) => {
			this.listeners.push(listener);
			return { dispose: () => {} };
		};
		fire(value: T) {
			for (const listener of this.listeners) {
				listener(value);
			}
		}
	}

	const api = {
		workspace: {
			getConfiguration: () => ({ get: () => undefined }),
			onDidChangeTextDocument: () => ({ dispose: () => {} }),
			onDidCloseTextDocument: () => ({ dispose: () => {} }),
			onDidChangeConfiguration: () => ({ dispose: () => {} }),
			getWorkspaceFolder: () => undefined,
		},
		window: {
			showErrorMessage: () => {},
			showInformationMessage: () => {},
			showQuickPick: () => {},
			showTextDocument: () => {},
			createOutputChannel: () => {},
		},
		CodeLens,
		ColorThemeKind: {
			Light: 1,
			Dark: 2,
			HighContrast: 3,
			HighContrastLight: 4,
		},
		commands: {
			executeCommand: async () => undefined,
		},
		CompletionItem,
		CompletionItemKind: {
			Function: 2,
			Variable: 5,
			Module: 8,
			Value: 11,
			Keyword: 13,
		},
		ConfigurationTarget: {},
		EventEmitter,
		MarkdownString,
		Position,
		Range: Range,
		Uri: {
			parse: (value: string) => ({ toString: () => value }),
			file: (fsPath: string) => ({
				fsPath,
				path: fsPath,
				scheme: "file",
				toString: () => `file://${fsPath}`,
			}),
		},
	};

	// `import vscode from "vscode"` reads the default export
	return { ...api, default: api };
});
