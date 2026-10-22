// The screenshots. Each shot starts with no open editor, then opens what it
// needs, and saves the window or a part of it to `out`.
import { lineOf } from "./demo-project.mjs";
import { miseStatusBarItem, windowSize } from "./ui.mjs";

/** @type {{name: string, out: string, run: (ui: import("./ui.mjs").Ui) => Promise<void>}[]} */
export const shots = [
	{
		name: "hero",
		out: "screenshots/mise-vscode-screenshot.png",
		async run(ui) {
			await ui.showMiseViews({ tasks: true, tools: true, env: true });
			await ui.showEnvValues();
			// every task and every variable shows
			await ui.resizePane("Tasks", 110);
			await ui.resizePane("Tools", -40);
			await ui.openFile("mise.toml");
			await ui.page
				.locator(".statusbar-item", { hasText: "Missing tools" })
				.waitFor();
			await ui.screenshot();
		},
	},
	{
		name: "tools-decoration",
		out: "docs/src/assets/tools-decoration.png",
		async run(ui) {
			await ui.openFile("mise.toml");
			await ui.screenshot(await ui.editorLines(1, lineOf("[env]") - 2, 560));
		},
	},
	{
		name: "tools-activity-bar",
		out: "docs/src/assets/tools-activity-bar.png",
		async run(ui) {
			await ui.showMiseViews({ tasks: false, tools: true, env: false });
			await ui.treeRow("Tools", /^node /).click({ button: "right" });
			await ui.screenshot(
				await ui.clip([ui.paneHeader("Tools"), ui.contextMenu()]),
			);
		},
	},
	{
		name: "tools-list",
		out: "docs/src/assets/tools-list.png",
		async run(ui) {
			// the table is wider than the editor next to the side bar
			await ui.command("View: Close Primary Side Bar");
			await ui.command("Mise: List all Tools");
			await ui.webview().getByText("is available").waitFor();
			const editor = await ui.page
				.locator("#workbench\\.parts\\.editor")
				.boundingBox();
			const lastRow = await ui
				.webview()
				.locator("vscode-table-row")
				.last()
				.boundingBox();
			await ui.screenshot({
				...editor,
				height: lastRow.y + lastRow.height + 16 - editor.y,
			});
		},
	},
	{
		name: "task-activity-bar",
		out: "docs/src/assets/task-activity-bar.png",
		async run(ui) {
			await ui.showMiseViews({ tasks: true, tools: false, env: false });
			await ui.openFile("mise.toml");
			await ui.goToLine(1);
			// a click on a task opens its definition
			await ui.treeRow("Tasks", /^build/).click();
			await ui.page
				.locator(".statusbar-item", {
					hasText: `Ln ${lineOf("[tasks.build]")},`,
				})
				.waitFor();
			await ui.treeRow("Tasks", /^build/).hover();
			await ui.screenshot(
				await ui.clip(
					[
						ui.paneHeader("Tasks"),
						ui.treeRow("Tasks", /^test/),
						ui.lineNumber(lineOf("[tasks.build]") + 2),
					],
					{ width: 680 },
				),
			);
		},
	},
	{
		name: "task-run-activity-bar",
		out: "docs/src/assets/task-run-activity-bar.png",
		async run(ui) {
			await ui.showMiseViews({ tasks: true, tools: false, env: false });
			// the only selected row
			await ui.treeRow("Tasks", /^test/).click();
			await ui.treeRow("Tasks", /^test/).click({ button: "right" });
			await ui.contextMenu().waitFor();
			await ui.screenshot(
				await ui.clip([ui.paneHeader("Tasks"), ui.contextMenu()]),
			);
		},
	},
	{
		name: "task-code-lens",
		out: "docs/src/assets/task-code-lens.png",
		async run(ui) {
			await ui.openFile("mise.toml");
			const [from, to] = [lineOf("[tasks.build]"), lineOf("[tasks.lint]") - 2];
			await ui.reveal(from, to);
			await ui.screenshot(await ui.editorLines(from, to, 620));
		},
	},
	{
		name: "tasks-command-palette",
		out: "docs/src/assets/tasks-command-palette.png",
		async run(ui) {
			await ui.openFile("mise.toml");
			// recently used commands come first
			await ui.command("Mise: Run task");
			await ui.page
				.locator(".quick-input-widget .monaco-list-row", { hasText: "build" })
				.first()
				.waitFor();
			await ui.page.keyboard.press("Escape");
			await ui.page.locator(".quick-input-widget").waitFor({ state: "hidden" });
			await ui.quickInput(">mise run task");
			await ui.page.mouse.move(windowSize.width - 1, windowSize.height - 1);
			await ui.screenshot(
				await ui.clip([ui.page.locator(".quick-input-widget")]),
			);
		},
	},
	{
		name: "create-file-task",
		out: "docs/src/assets/create-file-task.png",
		async run(ui) {
			await ui.showMiseViews({ tasks: true, tools: false, env: false });
			const header = ui.paneHeader("Tasks");
			await header.hover();
			await header
				.getByRole("button", { name: "Mise: Create File Task" })
				.hover();
			await ui.screenshot(
				await ui.clip([header, ui.hover(), ui.treeRow("Tasks", /^build/)]),
			);
		},
	},
	{
		name: "env",
		out: "docs/src/assets/env-1.png",
		async run(ui) {
			await ui.showMiseViews({ tasks: false, tools: false, env: true });
			await ui.showEnvValues();
			await ui.openFile("mise.toml");
			await ui.goToLine(1);
			// a click on a variable opens its definition
			await ui.treeRow("Environment Variables", /^NODE_ENV=/).click();
			await ui.page
				.locator(".statusbar-item", { hasText: "selected" })
				.waitFor();
			await ui.screenshot(
				await ui.clip(
					[
						ui.page.locator(".editor-instance .codelens-decoration").first(),
						ui.paneHeader("Environment Variables"),
						ui.treeRow("Environment Variables", /^PROJECT_NAME=/),
					],
					{ width: 760 },
				),
			);
		},
	},
	{
		name: "mise-toml-language-support",
		out: "docs/src/assets/mise-toml-language-support.png",
		async run(ui) {
			await ui.openFile("mise.toml");
			const [from, to] = [lineOf("[env]"), lineOf("[tasks.lint]") - 2];
			await ui.reveal(from, to);
			await ui.screenshot(await ui.editorLines(from, to, 620));
		},
	},
	{
		name: "syntax-highlighting-shebang",
		out: "docs/src/content/docs/reference/syntax-highlighting-shebang.png",
		async run(ui) {
			await ui.openFile("mise.toml");
			const [from, to] = [lineOf("[tasks.hello]"), lineOf("[settings]") - 2];
			await ui.reveal(from, to);
			await ui.screenshot(await ui.editorLines(from, to, 620));
		},
	},
	{
		name: "task-dependencies",
		out: "docs/src/content/docs/reference/task-dependencies.png",
		async run(ui) {
			await ui.showMiseViews({ tasks: true, tools: false, env: false });
			await ui.command("Mise: Visualize Tasks Dependencies");
			await ui.webview().getByTestId("rf__node-deploy").waitFor();
			await ui.page.waitForTimeout(1000);
			await ui.screenshot();
		},
	},
	{
		name: "mise-menu",
		out: "docs/src/assets/mise-menu.png",
		async run(ui) {
			await ui.showMiseViews({ tasks: true, tools: false, env: false });
			await ui.command("Preferences: Open Settings (UI)");
			// the search box has the focus
			await ui.page.locator(".settings-editor").waitFor();
			await ui.page.keyboard.type("@ext:hverlin.mise-vscode");
			await ui.page.waitForTimeout(1000);
			await miseStatusBarItem(ui.page).click();
			await ui.page
				.locator(".quick-input-widget .monaco-list-row")
				.first()
				.waitFor();
			await ui.page.mouse.move(windowSize.width - 1, windowSize.height / 2);
			await ui.screenshot();
		},
	},
	{
		name: "autocomplete-tool-version",
		out: "docs/src/content/docs/reference/autocomplete-tool-version.png",
		// the edit is reverted by the next reset
		async run(ui) {
			await ui.openFile("mise.toml");
			await ui.goToLine(lineOf("[env]") - 2);
			await ui.page.keyboard.press("Enter");
			await ui.page.keyboard.type("deno = ");
			await ui.page.keyboard.press("Control+Space");
			// the versions come from `mise ls-remote`
			await ui.page
				.locator(".suggest-widget .monaco-list-row")
				.nth(5)
				.waitFor({ timeout: 30_000 });
			await ui.page.waitForTimeout(500);
			const lines = await ui.editorLines(1, lineOf("[env]"), 0);
			const suggest = await ui.page.locator(".suggest-widget").boundingBox();
			await ui.screenshot({
				...lines,
				width: suggest.x + suggest.width + 8 - lines.x,
				height: suggest.y + suggest.height + 8 - lines.y,
			});
		},
	},
	{
		name: "env-terminal-settings",
		out: "docs/src/assets/env-terminal-settings.png",
		async run(ui) {
			await ui.command("Preferences: Open Settings (UI)");
			await ui.page.locator(".settings-editor").waitFor();
			await ui.page.keyboard.type("mise.updateOpenTerminalsEnvAutomatically");
			const setting = ui.page
				.locator(".settings-editor .setting-item-contents")
				.filter({ hasText: "Update Open Terminals Env Automatically" });
			await setting.waitFor();
			await ui.page.mouse.move(windowSize.width - 1, windowSize.height / 2);
			await ui.page.waitForTimeout(500);
			await ui.screenshot(await ui.clip([setting], { margin: 0 }));
		},
	},
];
