// The videos: short clips of the features, which are joined into the demo
// video of the docs home page, in this order.
//
// They come after the screenshots: the tools clip installs python, which the
// screenshots show missing. The edits of a clip are reverted by the next
// reset.
import { lineOf } from "./demo-projects.mjs";

/** a line of the editor that starts with `text` */
const editorLine = (page, text) => {
	// the editor shows spaces as non-breaking spaces
	const pattern = text
		.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		.replaceAll(" ", "\\s");
	return page
		.locator(".editor-instance .view-line")
		.filter({ hasText: new RegExp(`^${pattern}`) });
};

const codeLens = (page, text) =>
	page.locator(".editor-instance .codelens-decoration a", { hasText: text });

/** @type {import("./shots.mjs").Shot[]} */
export const videos = [
	{
		name: "video-tools",
		out: "docs/public/videos/tools.mp4",
		video: true,
		async run(ui) {
			const { page, video } = ui;
			const pause = (ms) => page.waitForTimeout(ms);
			await ui.showOverview();
			const missingTools = page.locator(".statusbar-item", {
				hasText: "Missing tools",
			});
			await missingTools.waitFor();

			await video.record(async () => {
				await video.caption("Go to a tool, and see what is installed");
				await pause(800);
				await video.click(ui.treeRow("Tools", /^node /), {
					offset: { x: 60, y: 11 },
				});
				await pause(700);
				await video.moveTo(editorLine(page, 'node = "24"'), {
					offset: { x: 18, y: 9 },
				});
				await ui.hover().waitFor();
				await pause(2000);

				await video.caption("Add a tool, and pick its version");
				await video.click(editorLine(page, 'python = "3.13"'), {
					offset: { x: 200, y: 9 },
				});
				await page.keyboard.press("End");
				await page.keyboard.press("Enter");
				// the closing quote is added
				await video.type('deno = "');
				await page.keyboard.press("Control+Space");
				// the versions come from `mise ls-remote`
				await page
					.locator(".suggest-widget .monaco-list-row")
					.nth(5)
					.waitFor({ timeout: 30_000 });
				await pause(1200);
				await page.keyboard.press("ArrowDown");
				await pause(500);
				await page.keyboard.press("Enter");
				await pause(800);
				await page.keyboard.press("Meta+s");
				// once mise read the saved file
				await missingTools.filter({ hasText: "deno" }).waitFor();
				await pause(1500);

				await video.caption("Install the missing tools");
				await video.click(codeLens(page, "Install missing tools"));
				// the downloads are cut short
				await pause(1500);
				await video.cut(() =>
					missingTools.waitFor({ state: "hidden", timeout: 300_000 }),
				);
				await pause(2000);
			});

			// mise.toml as the next clips show it
			await ui.goToLine(lineOf("python") + 1);
			await page.keyboard.press("Meta+Shift+k");
			await page.keyboard.press("Meta+s");
			await page.locator(".tab.dirty").waitFor({ state: "detached" });
		},
	},
	{
		name: "video-tasks",
		out: "docs/public/videos/tasks.mp4",
		video: true,
		async run(ui) {
			const { page, video } = ui;
			const pause = (ms) => page.waitForTimeout(ms);
			await ui.showOverview();

			await video.record(async () => {
				await video.caption("Run a task from the side bar");
				const hello = ui.treeRow("Tasks", /^hello/);
				await video.moveTo(hello, { offset: { x: 60, y: 11 } });
				await pause(500);
				await video.click(
					hello.getByRole("button", { name: "Mise: Run task", exact: true }),
				);
				await page
					.locator(".terminal-wrapper")
					.filter({ visible: true })
					.first()
					.waitFor();
				await pause(3000);

				await video.caption("See how the tasks depend on each other");
				// room for the graph
				await video.click(
					page
						.locator("#workbench\\.parts\\.panel")
						.getByRole("button", { name: /^Hide Panel/ }),
				);
				await pause(500);
				await page.keyboard.press("F1");
				await video.type("visualize tasks");
				await pause(500);
				await page.keyboard.press("Enter");
				const deploy = ui.webview().getByTestId("rf__node-deploy");
				await deploy.waitFor();
				await pause(1000);
				await video.moveTo(deploy);
				await pause(2500);
			});
		},
	},
	{
		name: "video-env",
		out: "docs/public/videos/env.mp4",
		video: true,
		async run(ui) {
			const { page, video } = ui;
			const pause = (ms) => page.waitForTimeout(ms);
			await ui.showOverview();

			await video.record(async () => {
				await video.caption("Go to an environment variable");
				await video.click(
					ui.treeRow("Environment Variables", /^PROJECT_NAME=/),
					{ offset: { x: 80, y: 11 } },
				);
				await pause(2000);

				await video.caption("It is set in the terminals, with the tools");
				await page.keyboard.press("Control+Shift+Backquote");
				await page
					.locator(".terminal-wrapper")
					.filter({ visible: true })
					.first()
					.waitFor();
				// the prompt
				await pause(1500);
				await video.type("echo $PROJECT_NAME");
				await page.keyboard.press("Enter");
				await pause(800);
				await video.type("node --version");
				await page.keyboard.press("Enter");
				await pause(2500);
			});
		},
	},
	{
		name: "video-daemons",
		out: "docs/public/videos/daemons.mp4",
		project: "web-app",
		video: true,
		async run(ui) {
			const { page, video } = ui;
			const pause = (ms) => page.waitForTimeout(ms);
			await ui.showMiseViews({ tasks: false, daemons: true });
			await ui.openFile("mise.toml");

			await video.record(async () => {
				await video.caption("Start a daemon, and the ones it depends on");
				const web = ui.treeRow("Daemons", /^web/);
				await video.moveTo(web, { offset: { x: 60, y: 11 } });
				await pause(500);
				await video.click(
					web.getByRole("button", { name: "Mise: Start Daemon", exact: true }),
				);
				await web.filter({ hasText: "4518" }).waitFor({ timeout: 60_000 });
				await pause(2000);

				await video.caption("Follow its logs");
				await video.moveTo(web, { offset: { x: 60, y: 11 } });
				await video.click(
					web.getByRole("button", {
						name: "Mise: Show Daemon Logs",
						exact: true,
					}),
				);
				await page
					.locator(".terminal-wrapper")
					.filter({ visible: true })
					.first()
					.waitFor();
				// web asks api for its items every second
				await pause(6000);
			});
		},
	},
	{
		name: "video-lockfile",
		out: "docs/public/videos/lockfile.mp4",
		project: "locked-app",
		video: true,
		async run(ui) {
			const { page, video } = ui;
			const pause = (ms) => page.waitForTimeout(ms);
			await ui.openFile("mise.lock");
			const outOfSync = codeLens(page, "out of sync");
			await outOfSync.waitFor();

			await video.record(async () => {
				await video.caption("Keep mise.lock in sync with mise.toml");
				await pause(1200);
				await video.click(outOfSync);
				await video.click(
					page
						.locator(".monaco-dialog-box")
						.getByRole("button", { name: "Update", exact: true }),
				);
				// the download of the checksums is cut short
				await pause(1000);
				await video.cut(() =>
					outOfSync.waitFor({ state: "detached", timeout: 120_000 }),
				);
				// with the new entry, first
				await pause(3000);
			});
		},
	},
	{
		name: "video-monorepo",
		out: "docs/public/videos/monorepo.mp4",
		project: "monorepo",
		video: true,
		async run(ui) {
			const { page, video } = ui;
			const pause = (ms) => page.waitForTimeout(ms);
			await ui.showMiseViews({ tasks: true, tools: false, env: false });
			await ui.openFile("mise.toml");

			await video.record(async () => {
				await video.caption("The tasks of every project of a monorepo");
				await pause(1200);
				for (const project of [/^\/\/packages\/api/, /^\/\/packages\/web/]) {
					await video.moveTo(ui.treeRow("Tasks", project), {
						offset: { x: 90, y: 11 },
					});
					await pause(1300);
				}

				await video.caption("Go to a task, and see what it depends on");
				// the build of web, which depends on the build of api
				const webBuild = page.locator(
					"#workbench\\.parts\\.sidebar .monaco-list-row",
					{ hasText: "Build the web app" },
				);
				await video.click(webBuild, { offset: { x: 40, y: 11 } });
				await pause(1200);
				await video.moveTo(
					editorLine(page, 'depends = ["//packages/api:build"]'),
					{ offset: { x: 180, y: 9 } },
				);
				await ui.hover().waitFor();
				await pause(3000);

				await video.caption(
					"See how the tasks of the projects depend on each other",
				);
				await video.moveTo({ x: 900, y: 600 });
				await page.keyboard.press("F1");
				await video.type("visualize tasks");
				await pause(500);
				await page.keyboard.press("Enter");
				await ui.webview().locator(".react-flow__node").first().waitFor();
				await pause(3500);

				await video.caption("Run one, with the tasks it depends on");
				await video.moveTo(webBuild, { offset: { x: 60, y: 11 } });
				await pause(700);
				await video.click(
					webBuild.getByRole("button", {
						name: "Mise: Run task",
						exact: true,
					}),
				);
				await page
					.locator(".terminal-wrapper")
					.filter({ visible: true })
					.first()
					.waitFor();
				await pause(4000);
			});
		},
	},
];
