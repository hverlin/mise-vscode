// Regenerates the screenshots of the README and of the docs, and the videos
// of the docs.
//
// VS Code runs with the built extension on demo projects, in folders of its
// own under /tmp: a fake home, mise data/config/state/cache dirs, VS Code user
// data and extensions. Nothing of the machine shows in the screenshots (home
// path, user name, host name, git author, accounts, other projects), and none
// of the machine's mise state, VS Code profiles or git config is read or
// changed. The folder is deleted at the end.
//
// Usage: node scripts/screenshots/index.mjs [--keep] [shot...]
// Without shots, every screenshot is taken. The videos are only recorded when
// named, or all of them with `videos`, and need ffmpeg in PATH; they are then
// joined into the demo video. Set VSCODE_VERSION to pick another VS Code
// version than the one below: the screenshots change with it.
//   --list   print the shot names
//   --keep   keep the folder under /tmp, as when a shot fails, with a
//            screenshot and the HTML of each failing shot
//
// To add a shot, add an entry to `shots` in shots.mjs, or to `videos` in
// videos.mjs, and what it needs to a demo project in demo-projects.mjs.
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
import { homeFiles, projects } from "./demo-projects.mjs";
import { shots } from "./shots.mjs";
import { helpers, miseStatusBarItem, windowSize } from "./ui.mjs";
import { join } from "./video.mjs";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

// short: the VS Code socket path, under the user data dir, must fit in 104
// bytes on macOS
const root = "/tmp/mise-vscode-screenshots";
// marks the folder as created by this script, so that a later run may delete
// it without risking to delete anything else
const marker = path.join(root, ".mise-vscode-screenshots");
const home = path.join(root, "home");
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
	// its hint shows in new terminals
	"terminal.integrated.suggest.enabled": false,
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
	MISE_DISABLE_HINTS: "*",
	PITCHFORK_STATE_DIR: path.join(home, ".local/state/pitchfork"),
	PITCHFORK_CONFIG_DIR: path.join(home, ".config/pitchfork"),
};

// the joined videos, in the order of `shots`
const demoVideo = "docs/public/demo.mp4";

const args = process.argv.slice(2);
const available = [...shots.map((shot) => shot.name), "videos"];
if (args.includes("--list")) {
	console.log(available.join("\n"));
	process.exit(0);
}
const names = args.filter((arg) => !arg.startsWith("--"));
const unknown = names.filter((name) => !available.includes(name));
if (unknown.length) {
	console.error(`Unknown shots: ${unknown.join(", ")}`);
	console.error(`Available: ${available.join(", ")}`);
	process.exit(1);
}
// the videos are only recorded when named: they take longer, and their files
// change with every recording
const selected = names.length
	? shots.filter(
			(shot) =>
				names.includes(shot.name) || (shot.video && names.includes("videos")),
		)
	: shots.filter((shot) => !shot.video);

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

/** writes `files`, by path relative to `dir`; scripts are executable */
const writeFiles = (dir, files) => {
	for (const [file, content] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		writeFileSync(path.join(dir, file), content);
		if (content.startsWith("#!")) {
			chmodSync(path.join(dir, file), 0o755);
		}
	}
};

/** runs the mise of the folder in `cwd` */
const mise = (cwd, ...miseArgs) =>
	execFileSync(path.join(binDir, "mise"), miseArgs, {
		cwd,
		env,
		stdio: "inherit",
	});

/** the folder, with a home, VS Code settings and the extension */
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
	writeFiles(home, homeFiles);
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
};

/** writes the demo project `name`, trusts its configs and sets it up */
const prepareProject = (name) => {
	const dir = path.join(home, name);
	const { files, setup } = projects[name];
	writeFiles(dir, files);
	for (const file of Object.keys(files)) {
		if (path.basename(file) === "mise.toml") {
			mise(dir, "trust", path.join(dir, file));
		}
	}
	setup(
		(...miseArgs) => mise(dir, ...miseArgs),
		(file, content) => writeFiles(dir, { [file]: content }),
	);
};

const launch = async (project) => {
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
	// VS Code opens each project in turn, for its shots
	const byProject = Map.groupBy(
		selected,
		(shot) => shot.project ?? "my-project",
	);
	for (const [name, projectShots] of byProject) {
		prepareProject(name);
		try {
			app = await launch(path.join(home, name));
			const page = await app.firstWindow();
			try {
				await ready(app, page);
			} catch (error) {
				await page.screenshot({
					path: path.join(root, `${name}-launch-failed.png`),
				});
				throw error;
			}
			for (const shot of projectShots) {
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
		} finally {
			await app?.close();
			app = undefined;
			try {
				projects[name].teardown?.((...miseArgs) =>
					mise(path.join(home, name), ...miseArgs),
				);
			} catch (error) {
				console.error(`Could not tear ${name} down: ${error.message}`);
			}
		}
	}
	if (!failed && selected.some((shot) => shot.video)) {
		const videos = shots
			.filter((shot) => shot.video)
			.map((shot) => path.join(repo, shot.out))
			.filter((file) => existsSync(file));
		join(videos, path.join(repo, demoVideo));
		console.log(`✔ ${videos.length} videos joined: ${demoVideo}`);
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
