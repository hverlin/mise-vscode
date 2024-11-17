// @ts-ignore
import { mock } from "bun:test";

mock.module("vscode", () => {
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
	};
});
