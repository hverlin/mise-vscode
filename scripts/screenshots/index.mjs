// Regenerates the screenshots of the README and of the docs.
//
// VS Code runs with the built extension on a demo project, in folders of its
// own under /tmp: a fake home, mise data/config/state/cache dirs, VS Code user
// data and extensions. Nothing of the machine shows in the screenshots (home
// path, user name, host name, git author, accounts, other projects), and none
// of the machine's mise state, VS Code profiles or git config is read or
// changed. The folder is deleted at the end.
//
// Usage: node scripts/screenshots/index.mjs [--keep] [shot...]
// Without shots, every shot is taken. Set VSCODE_VERSION to pick another
// VS Code version than the one below: the screenshots change with it.
//   --list   print the shot names
//   --keep   keep the folder under /tmp, as when a shot fails, with a
//            screenshot and the HTML of each failing shot
//
// To add a shot, add an entry to `shots` in shots.mjs, and what it needs to
// the demo project in demo-project.mjs.
import { execFileSync } from "node:child_process";
import {
	accessSync,
	chmodSync,
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { _electron } from "playwright-core";
import { files } from "./demo-project.mjs";
import { shots } from "./shots.mjs";
import { helpers, miseStatusBarItem, windowSize } from "./ui.mjs";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

// short: the VS Code socket path, under the user data dir, must fit in 104
// bytes on macOS
const root = "/tmp/mise-vscode-screenshots";
// marks the folder as created by this script, so that a later run may delete
// it without risking to delete anything else
const marker = path.join(root, ".mise-vscode-screenshots");
const home = path.join(root, "home");
const project = path.join(home, "my-project");
const userDataDir = path.join(root, "user-data");
const extensionsDir = path.join(root, "extensions");
const binDir = path.join(root, "bin");

// the screenshots, and the selectors of the shots, depend on it
const vscodeVersion = process.env.VSCODE_VERSION ?? "1.143.0";

const settings = {
	"workbench.colorTheme": "Default Dark Modern",
	"workbench.startupEditor": "none",
	"workbench.tips.enabled": false,
	"workbench.enableExperiments": false,
	"workbench.welcomePage.walkthroughs.openOnInstall": false,
	"workbench.secondarySideBar.defaultVisibility": "hidden",
	"workbench.layoutControl.enabled": false,
	"workbench.editor.empty.hint": "hidden",
	"workbench.reduceMotion": "on",
	"window.menuStyle": "custom",
	"window.dialogStyle": "custom",
	"window.commandCenter": true,
	"window.restoreWindows": "none",
	"chat.disableAIFeatures": true,
	"security.workspace.trust.enabled": false,
	"telemetry.telemetryLevel": "off",
	"update.mode": "none",
	"update.showReleaseNotes": false,
	"extensions.autoUpdate": false,
	"extensions.autoCheckUpdates": false,
	"extensions.ignoreRecommendations": true,
	"git.enabled": false,
	"editor.fontSize": 14,
	"editor.minimap.enabled": false,
	"editor.cursorBlinking": "solid",
	"editor.stickyScroll.enabled": false,
	"editor.matchBrackets": "never",
	"editor.renderLineHighlight": "none",
	"editor.occurrencesHighlight": "off",
	"workbench.editor.useModal": "off",
	// no cursor in the screenshots
	"workbench.colorCustomizations": { "editorCursor.foreground": "#0000" },
	"files.autoSave": "off",
	"mise.checkForNewMiseVersion": false,
};

// GitHub tokens only raise the rate limit of mise's GitHub API calls
const passThroughEnv = ["GITHUB_TOKEN", "MISE_GITHUB_TOKEN", "LANG"];

const env = {
	...Object.fromEntries(
		passThroughEnv
			.filter((name) => process.env[name])
			.map((name) => [name, process.env[name]]),
	),
	HOME: home,
	SHELL: "/bin/zsh",
	TMPDIR: path.join(root, "tmp"),
	PATH: [binDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
	MISE_DATA_DIR: path.join(home, ".local/share/mise"),
	MISE_CONFIG_DIR: path.join(home, ".config/mise"),
	MISE_STATE_DIR: path.join(home, ".local/state/mise"),
	MISE_CACHE_DIR: path.join(home, ".cache/mise"),
	MISE_GLOBAL_CONFIG_FILE: path.join(home, ".config/mise/config.toml"),
	MISE_SYSTEM_DIR: path.join(root, "etc/mise"),
	MISE_SYSTEM_DATA_DIR: path.join(root, "usr/share/mise"),
	MISE_CEILING_PATHS: home,
	MISE_YES: "1",
};

const args = process.argv.slice(2);
if (args.includes("--list")) {
	console.log(shots.map((shot) => shot.name).join("\n"));
	process.exit(0);
}
const names = args.filter((arg) => !arg.startsWith("--"));
const unknown = names.filter(
	(name) => !shots.some((shot) => shot.name === name),
);
if (unknown.length) {
	console.error(`Unknown shots: ${unknown.join(", ")}`);
	console.error(`Available: ${shots.map((shot) => shot.name).join(", ")}`);
	process.exit(1);
}
const selected = names.length
	? shots.filter((shot) => names.includes(shot.name))
	: shots;

const findMise = () => {
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		const candidate = path.join(dir, "mise");
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	throw new Error("mise not found in PATH");
};

const prepare = () => {
	rmSync(root, { recursive: true, force: true });
	// fails if the folder was created again in between, e.g. by another user:
	// bin/mise runs from it
	mkdirSync(root, { mode: 0o700 });
	writeFileSync(marker, "");
	for (const dir of [
		binDir,
		env.TMPDIR,
		path.join(userDataDir, "User/globalStorage"),
	]) {
		mkdirSync(dir, { recursive: true });
	}
	for (const [file, content] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), content);
	}
	chmodSync(path.join(project, "mise-tasks/release"), 0o755);
	writeFileSync(
		path.join(userDataDir, "User/settings.json"),
		JSON.stringify(settings, null, 2),
	);
	// the accounts menu is hidden from the activity bar
	const state = new DatabaseSync(
		path.join(userDataDir, "User/globalStorage/state.vscdb"),
	);
	state.exec(
		"CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
	);
	state
		.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
		.run("workbench.activity.showAccounts", "false");
	state.close();

	// installed rather than loaded with --extensionDevelopmentPath, which
	// shows "[Extension Development Host]" in the title bar
	const { publisher, name, version } = JSON.parse(
		readFileSync(path.join(repo, "package.json"), "utf8"),
	);
	mkdirSync(extensionsDir);
	symlinkSync(
		repo,
		path.join(extensionsDir, `${publisher}.${name}-${version}`),
	);

	// a copy, so that no path of the machine shows
	copyFileSync(findMise(), path.join(binDir, "mise"));
	const mise = (...miseArgs) =>
		execFileSync(path.join(binDir, "mise"), miseArgs, {
			cwd: project,
			env,
			stdio: "inherit",
		});
	mise("trust", path.join(project, "mise.toml"));
	// python is left missing on purpose, to show the missing tools, and jq
	// outdated, to show its update
	mise("install", "node", "jq@1.7.1");
};

const launch = async () => {
	const executablePath = await downloadAndUnzipVSCode({
		cachePath: path.join(repo, ".vscode-test"),
		version: vscodeVersion,
	});
	const app = await _electron.launch({
		executablePath,
		args: [
			`--user-data-dir=${userDataDir}`,
			`--extensions-dir=${extensionsDir}`,
			"--skip-welcome",
			"--skip-release-notes",
			"--disable-telemetry",
			"--disable-updates",
			"--disable-crash-reporter",
			"--use-inmemory-secretstorage",
			// no login shell to resolve the environment: it would add the PATH
			// of the machine
			"--force-disable-user-env",
			"--no-cached-data",
			"--locale=en",
			"--force-device-scale-factor=2",
			project,
		],
		env,
		cwd: project,
		timeout: 60_000,
	});
	return app;
};

/** sizes the window and waits for the extension */
const ready = async (app, page) => {
	await app.evaluate(({ BrowserWindow }, size) => {
		const window = BrowserWindow.getAllWindows()[0];
		window.setPosition(0, 0);
		window.setContentSize(size.width, size.height);
	}, windowSize);
	await page.locator(".monaco-workbench").waitFor();
	// the extension is ready once its status bar item shows
	await miseStatusBarItem(page).waitFor({ timeout: 60_000 });
};

if (existsSync(root) && !existsSync(marker)) {
	console.error(`${root} exists and was not created by this script`);
	process.exit(1);
}

let app;
let failed = 0;
try {
	prepare();
	app = await launch();
	const page = await app.firstWindow();
	try {
		await ready(app, page);
	} catch (error) {
		await page.screenshot({ path: path.join(root, "launch-failed.png") });
		throw error;
	}
	for (const shot of selected) {
		const ui = helpers(page, shot.out);
		try {
			await ui.reset();
			await shot.run(ui);
			console.log(`✔ ${shot.name}: ${shot.out}`);
		} catch (error) {
			failed++;
			console.error(`✘ ${shot.name}: ${error.message}`);
			await page.screenshot({
				path: path.join(root, `${shot.name}-failed.png`),
			});
			writeFileSync(
				path.join(root, `${shot.name}-failed.html`),
				await page.content(),
			);
		}
	}
} catch (error) {
	failed++;
	throw error;
} finally {
	await app?.close();
	if (failed || args.includes("--keep")) {
		console.error(`The files are kept in ${root}`);
	} else {
		rmSync(root, { recursive: true, force: true });
	}
}
process.exitCode = failed ? 1 : 0;
