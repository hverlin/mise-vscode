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
		Position,
		Range: Range,
	};
});
