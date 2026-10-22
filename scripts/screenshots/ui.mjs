// Drives VS Code for the shots, through the DOM of its window.
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

// logical pixels, captured at 2x
export const windowSize = { width: 1200, height: 800 };

/** @typedef {ReturnType<typeof helpers>} Ui */

export const miseStatusBarItem = (page) =>
	page.locator(".statusbar-item", { hasText: /^\s*Mise$/ });

/** functions the shots use to drive VS Code */
export function helpers(page, out) {
	const sidebar = page.locator("#workbench\\.parts\\.sidebar");
	const quickInput = page.locator(".quick-input-widget");
	const paneHeader = (title) =>
		page.locator(".pane-header").filter({
			has: page.locator("h3.title", { hasText: new RegExp(`^${title}$`, "i") }),
		});

	const ui = {
		page,

		/** a shot starts with no open editor, menu or quick input */
		async reset() {
			await page.keyboard.press("Escape");
			await page.keyboard.press("Escape");
			if (await page.locator(".tab.dirty").count()) {
				await ui.command("File: Revert File");
			}
			await ui.command("View: Close All Editors");
			await page
				.locator(".editor-instance")
				.first()
				.waitFor({ state: "detached" });
		},

		/** opens the quick input with `value` typed in it */
		async quickInput(value) {
			await page.keyboard.press("Escape");
			await page.keyboard.press("F1");
			await quickInput.locator("input").first().fill(value);
			await quickInput.locator(".monaco-list-row").first().waitFor();
			await page.waitForTimeout(300);
		},

		/** runs a command from the command palette, by its exact title */
		async command(title) {
			await ui.quickInput(`>${title}`);
			const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			await quickInput
				.locator(".monaco-list-row")
				.filter({
					has: page.locator(".label-name", {
						hasText: new RegExp(`^${escaped}$`),
					}),
				})
				.first()
				.click();
		},

		async openFile(name) {
			await ui.quickInput(name);
			await quickInput
				.locator(".monaco-list-row", { hasText: name })
				.first()
				.click();
			await page.locator(`.tab.active[data-resource-name="${name}"]`).waitFor();
			if (name.endsWith(".toml")) {
				await page
					.locator(".editor-instance .codelens-decoration")
					.filter({ visible: true })
					.first()
					.waitFor();
			}
			await page.waitForTimeout(500);
		},

		async goToLine(line) {
			await ui.quickInput(`:${line}`);
			await page.keyboard.press("Enter");
			// keys pressed before the editor has the focus back are lost
			await quickInput.waitFor({ state: "hidden" });
			await page.keyboard.press("End");
		},

		/** scrolls the editor so that lines `from` to `to` show */
		async reveal(from, to) {
			// from the top, the middle line is centered if it does not show
			await ui.goToLine(1);
			await ui.goToLine(Math.round((from + to) / 2));
		},

		lineNumber(line) {
			return page
				.locator(".editor-instance .margin-view-overlays .line-numbers")
				.filter({ hasText: new RegExp(`^${line}$`) })
				.first();
		},

		/** top of `line` in the editor, or of the code lens above it */
		async lineTop(line) {
			const box = await ui.lineNumber(line).boundingBox();
			let top = box.y;
			for (const lens of await page
				.locator(".editor-instance .codelens-decoration")
				.all()) {
				const b = await lens.boundingBox();
				if (b && b.y < box.y && b.y > box.y - 2 * box.height) {
					top = Math.min(top, b.y);
				}
			}
			return top;
		},

		/**
		 * clip of the editor from line `from` (and the code lens above it) to
		 * line `to`, `width` pixels wide
		 */
		async editorLines(from, to, width) {
			const editor = await page
				.locator(".editor-instance .monaco-editor")
				.first()
				.boundingBox();
			const top = await ui.lineTop(from);
			const last = await ui.lineNumber(to).boundingBox();
			return {
				x: editor.x,
				y: top - 4,
				width,
				height: last.y + last.height - top + 8,
			};
		},

		/**
		 * clip around `locators`, with a margin, and at least `width` pixels
		 * wide from the left of the first one
		 */
		async clip(locators, { width = 0, margin = 8 } = {}) {
			const boxes = [];
			for (const locator of locators) {
				await locator.waitFor();
				boxes.push(await locator.boundingBox());
			}
			const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - margin);
			const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - margin);
			const right = Math.min(
				windowSize.width,
				Math.max(
					...boxes.map((b) => b.x + b.width + margin),
					boxes[0].x + width,
				),
			);
			const bottom = Math.min(
				windowSize.height,
				Math.max(...boxes.map((b) => b.y + b.height)) + margin,
			);
			return { x: left, y: top, width: right - left, height: bottom - top };
		},

		paneHeader(title) {
			return sidebar.locator(paneHeader(title));
		},

		contextMenu() {
			return page.locator(".context-view .monaco-menu");
		},

		/** the row of the tree view `pane` whose label matches `label` */
		treeRow(pane, label) {
			return sidebar
				.locator(".pane")
				.filter({ has: paneHeader(pane) })
				.locator(".monaco-list-row")
				.filter({ has: page.locator(".label-name", { hasText: label }) })
				.first();
		},

		/** opens the mise views, each pane expanded or collapsed */
		async showMiseViews(expanded) {
			await ui.command("View: Show Mise");
			const panes = {
				tasks: "Tasks",
				tools: "Tools",
				env: "Environment Variables",
			};
			for (const [key, title] of Object.entries(panes)) {
				const header = ui.paneHeader(title);
				await header.waitFor();
				if (
					(await header.getAttribute("aria-expanded")) !== String(expanded[key])
				) {
					// the middle of the header has its actions
					await header.locator("h3.title").click();
				}
			}
			await sidebar.locator(".monaco-list-row").first().waitFor();
			await page.waitForTimeout(1000);
			await page.mouse.move(windowSize.width - 1, windowSize.height / 2);
		},

		/** the values are hidden by default */
		async showEnvValues() {
			const header = ui.paneHeader("Environment Variables");
			await header.hover();
			const toggle = header.getByRole("button", {
				name: /^Mise: (Show|Hide) All Environment Variable Values$/,
			});
			await toggle.waitFor();
			if ((await toggle.getAttribute("aria-label")).includes("Show")) {
				await toggle.click();
			}
		},

		/** moves the bottom edge of the pane `title` by `delta` pixels */
		async resizePane(title, delta) {
			const pane = await sidebar
				.locator(".pane")
				.filter({ has: paneHeader(title) })
				.boundingBox();
			const bottom = pane.y + pane.height;
			for (const sash of await sidebar
				.locator(".monaco-sash.horizontal")
				.all()) {
				const b = await sash.boundingBox();
				if (b && Math.abs(b.y + b.height / 2 - bottom) < 4) {
					const x = b.x + b.width / 2;
					const y = b.y + b.height / 2;
					await page.mouse.move(x, y);
					await page.mouse.down();
					await page.mouse.move(x, y + delta, { steps: 5 });
					await page.mouse.up();
					return;
				}
			}
			throw new Error(`no sash below the ${title} pane`);
		},

		/** the visible hover, or tooltip */
		hover() {
			return page.locator(".monaco-hover").filter({ visible: true });
		},

		/** the frame of the visible webview */
		webview() {
			return page
				.frameLocator("iframe.webview.ready")
				.frameLocator("#active-frame");
		},

		/** saves the window, or the `clip` part of it */
		async screenshot(clip) {
			await page.screenshot({
				path: path.join(repo, out),
				clip,
				animations: "disabled",
			});
		},
	};
	return ui;
}
