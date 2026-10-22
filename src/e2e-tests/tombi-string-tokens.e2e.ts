import * as assert from "node:assert";
import * as path from "node:path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
	recommendTombiStringTokensOff,
	TOMBI_STRING_TOKENS_NOTIFICATION_SHOWN_KEY,
} from "../utils/tombiStringTokens";

/**
 * The default suite installs Tombi, whose semantic tokens for strings hide the
 * shell highlighting of task scripts. The documents are opened without an
 * editor, so the extension host does not offer the same thing meanwhile.
 */
suite("Tombi String Tokens Test Suite", () => {
	const sandbox = sinon.createSandbox();
	const STRING_TOKENS_SETTING = "semanticTokens.strings.enabled";
	let workspaceRoot: string;

	const createFakeContext = () => {
		const globalStore = new Map<string, unknown>();
		return {
			globalState: {
				get: (key: string) => globalStore.get(key),
				update: async (key: string, value: unknown) => {
					globalStore.set(key, value);
				},
			},
		} as unknown as vscode.ExtensionContext;
	};

	const openFixture = (name: string) =>
		vscode.workspace.openTextDocument(path.join(workspaceRoot, name));

	const tombiConfig = () => vscode.workspace.getConfiguration("tombi");

	const stubNotification = (answer: string | undefined) =>
		sandbox
			.stub(vscode.window, "showInformationMessage")
			.resolves(answer as never);

	setup(() => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
	});

	teardown(async () => {
		sandbox.restore();
		await tombiConfig().update(
			STRING_TOKENS_SETTING,
			undefined,
			vscode.ConfigurationTarget.Global,
		);
	});

	test("Tombi has the setting", () => {
		assert.equal(
			tombiConfig().inspect<boolean>(STRING_TOKENS_SETTING)?.defaultValue,
			true,
			"Tombi 1.9.0 or later should be installed",
		);
	});

	test("turns off Tombi's string tokens from a mise config file", async () => {
		const notification = stubNotification("Turn Off");
		const context = createFakeContext();

		const shown = await recommendTombiStringTokensOff(
			context,
			await openFixture("mise.toml"),
		);

		assert.ok(shown, `not shown: ${JSON.stringify(notification.args)}`);
		assert.equal(
			tombiConfig().inspect<boolean>(STRING_TOKENS_SETTING)?.globalValue,
			false,
		);
		assert.equal(
			context.globalState.get(TOMBI_STRING_TOKENS_NOTIFICATION_SHOWN_KEY),
			true,
		);
	});

	test("is shown only once, and dismissing it changes nothing", async () => {
		stubNotification(undefined);
		const context = createFakeContext();
		const document = await openFixture("mise.toml");

		assert.ok(await recommendTombiStringTokensOff(context, document));
		assert.equal(await recommendTombiStringTokensOff(context, document), false);
		assert.equal(
			tombiConfig().inspect<boolean>(STRING_TOKENS_SETTING)?.globalValue,
			undefined,
		);
	});

	test("is not shown for a TOML file that is not a mise config", async () => {
		stubNotification(undefined);

		const shown = await recommendTombiStringTokensOff(
			createFakeContext(),
			await openFixture("tera-highlighting.toml"),
		);

		assert.equal(shown, false);
	});

	test("is not shown once Tombi's string tokens are off", async () => {
		stubNotification(undefined);
		await tombiConfig().update(
			STRING_TOKENS_SETTING,
			false,
			vscode.ConfigurationTarget.Global,
		);

		const shown = await recommendTombiStringTokensOff(
			createFakeContext(),
			await openFixture("mise.toml"),
		);

		assert.equal(shown, false);
	});
});
