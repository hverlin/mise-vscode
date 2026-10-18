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
		ConfigurationTarget: {},
		EventEmitter,
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

	// `import vscode from "vscode"` reads the default export
	return { ...api, default: api };
});
