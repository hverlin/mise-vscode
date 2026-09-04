import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
	collapseHomePath,
	compareSourcePaths,
	expandPath,
	getShebangFileExtension,
	getSourceProximityRank,
	isBareCommand,
	isPathInside,
	locateCommand,
	resolveConfiguredBinPath,
	setupTaskFile,
} from "./fileUtils";

describe("getSourceProximityRank", () => {
	const workspaceRoot = "/repo/monorepo";

	it("ranks workspace sources first", () => {
		expect(
			getSourceProximityRank("/repo/monorepo/mise.toml", workspaceRoot),
		).toBe(0);
		expect(
			getSourceProximityRank(
				"/repo/monorepo/projects/frontend/mise.toml",
				workspaceRoot,
			),
		).toBe(0);
	});

	it("ranks parent configs after workspace sources", () => {
		expect(getSourceProximityRank("/repo/mise.toml", workspaceRoot)).toBe(1);
	});

	it("ranks global configs last", () => {
		expect(
			getSourceProximityRank(
				"/home/user/.config/mise/config.toml",
				workspaceRoot,
			),
		).toBe(2);
	});

	it("ranks everything as global without a workspace root", () => {
		expect(getSourceProximityRank("/repo/mise.toml", undefined)).toBe(2);
	});
});

describe("compareSourcePaths", () => {
	const workspaceRoot = "/repo/monorepo";

	it("puts the workspace root config before project configs", () => {
		const sources = [
			"/repo/monorepo/kotlin/android/mise.toml",
			"/repo/monorepo/mise.toml",
			"/repo/monorepo/rust/mise.toml",
		];
		sources.sort((a, b) => compareSourcePaths(a, b, workspaceRoot));
		expect(sources).toEqual([
			"/repo/monorepo/mise.toml",
			"/repo/monorepo/kotlin/android/mise.toml",
			"/repo/monorepo/rust/mise.toml",
		]);
	});

	it("keeps the config files of a project together", () => {
		const sources = [
			"/repo/monorepo/kotlin/android/mise.toml",
			"/repo/monorepo/rust/mise.toml",
			"/repo/monorepo/kotlin/android/mise-tasks",
		];
		sources.sort((a, b) => compareSourcePaths(a, b, workspaceRoot));
		expect(sources).toEqual([
			"/repo/monorepo/kotlin/android/mise-tasks",
			"/repo/monorepo/kotlin/android/mise.toml",
			"/repo/monorepo/rust/mise.toml",
		]);
	});

	it("puts parent configs before global ones", () => {
		const sources = [
			"/home/user/.config/mise/config.toml",
			"/repo/mise.toml",
			"/repo/monorepo/mise.toml",
		];
		sources.sort((a, b) => compareSourcePaths(a, b, workspaceRoot));
		expect(sources).toEqual([
			"/repo/monorepo/mise.toml",
			"/repo/mise.toml",
			"/home/user/.config/mise/config.toml",
		]);
	});
});

describe("getShebangFileExtension", () => {
	it("detects shells", () => {
		expect(getShebangFileExtension("#!/bin/bash\necho hi")).toBe("sh");
		expect(getShebangFileExtension("#!/usr/bin/env bash\n")).toBe("sh");
		expect(getShebangFileExtension("#!/bin/zsh\n")).toBe("sh");
	});

	it("detects other languages", () => {
		expect(getShebangFileExtension("#!/usr/bin/env python3\n")).toBe("py");
		expect(getShebangFileExtension("#!/usr/bin/env python3.12\n")).toBe("py");
		expect(getShebangFileExtension("#!/usr/bin/env node\n")).toBe("js");
		expect(getShebangFileExtension("#!/usr/bin/env -S deno run\n")).toBe("ts");
	});

	it("returns undefined without a shebang or for unknown interpreters", () => {
		expect(getShebangFileExtension("echo hi")).toBeUndefined();
		expect(getShebangFileExtension("#!/usr/bin/env made-up\n")).toBeUndefined();
	});
});

describe("resolveConfiguredBinPath", () => {
	const folders = [
		{ name: "frontend", fsPath: "/repo/frontend" },
		{ name: "backend", fsPath: "/repo/backend" },
	];
	const existsIn = (...paths: string[]) => {
		return (filePath: string) => paths.includes(filePath);
	};
	// biome-ignore lint/suspicious/noTemplateCurlyInString: literal VS Code variable
	const workspaceFolderVar = "${workspaceFolder}";

	it("leaves bare command names untouched for PATH lookup", () => {
		expect(resolveConfiguredBinPath("mise", folders, existsIn())).toBe("mise");
		expect(resolveConfiguredBinPath("mise.exe", folders, existsIn())).toBe(
			"mise.exe",
		);
	});

	it("leaves absolute paths untouched", () => {
		expect(
			resolveConfiguredBinPath("/usr/local/bin/mise", folders, existsIn()),
		).toBe("/usr/local/bin/mise");
	});

	it("resolves relative paths against the first workspace folder containing the file", () => {
		expect(
			resolveConfiguredBinPath(
				"./bin/mise",
				folders,
				existsIn("/repo/backend/bin/mise"),
			),
		).toBe("/repo/backend/bin/mise");
		expect(
			resolveConfiguredBinPath(
				"bin/mise",
				folders,
				existsIn("/repo/frontend/bin/mise", "/repo/backend/bin/mise"),
			),
		).toBe("/repo/frontend/bin/mise");
	});

	it("falls back to the first workspace folder when the file does not exist", () => {
		expect(resolveConfiguredBinPath("./bin/mise", folders, existsIn())).toBe(
			"/repo/frontend/bin/mise",
		);
	});

	it("resolves workspaceFolder variables", () => {
		expect(
			resolveConfiguredBinPath(
				`${workspaceFolderVar}/bin/mise`,
				folders,
				existsIn("/repo/backend/bin/mise"),
			),
		).toBe("/repo/backend/bin/mise");
		expect(
			resolveConfiguredBinPath(
				`${workspaceFolderVar}/bin/mise`,
				folders,
				existsIn(),
			),
		).toBe("/repo/frontend/bin/mise");
	});

	it("resolves named workspaceFolder variables against the named folder", () => {
		expect(
			resolveConfiguredBinPath(
				// biome-ignore lint/suspicious/noTemplateCurlyInString: literal VS Code variable
				"${workspaceFolder:backend}/bin/mise",
				folders,
				existsIn(),
			),
		).toBe("/repo/backend/bin/mise");
	});

	it("expands the home directory prefix", () => {
		const resolved = resolveConfiguredBinPath(
			"~/bin/mise",
			folders,
			existsIn(),
		);
		expect(resolved.endsWith("bin/mise")).toBe(true);
		expect(resolved.startsWith("~")).toBe(false);
	});

	it("returns the configured path unchanged without workspace folders", () => {
		expect(resolveConfiguredBinPath("./bin/mise", [], existsIn())).toBe(
			"./bin/mise",
		);
		expect(
			resolveConfiguredBinPath(
				`${workspaceFolderVar}/bin/mise`,
				[],
				existsIn(),
			),
		).toBe(`${workspaceFolderVar}/bin/mise`);
	});
});

describe("setupTaskFile", () => {
	const withTaskDir = async (run: (taskDir: string) => Promise<void>) => {
		const root = await mkdtemp(path.join(tmpdir(), "mise-task-"));
		try {
			await run(path.join(root, "mise-tasks"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	};

	it("creates an executable task file inside the task directory", async () => {
		await withTaskDir(async (taskDir) => {
			const taskFile = path.join(taskDir, "build");

			await setupTaskFile(taskFile, taskDir);

			const stats = await stat(taskFile);
			expect(stats.isFile()).toBe(true);
			if (process.platform !== "win32") {
				expect(stats.mode & 0o111).toBeGreaterThan(0);
			}
		});
	});

	it("supports nested task files", async () => {
		await withTaskDir(async (taskDir) => {
			const taskFile = path.join(taskDir, "ci", "lint");

			await setupTaskFile(taskFile, taskDir);

			expect((await stat(taskFile)).isFile()).toBe(true);
		});
	});

	it("refuses a name escaping the task directory", async () => {
		await withTaskDir(async (taskDir) => {
			const escaping = path.join(taskDir, "..", "..", "escaped");

			await expect(setupTaskFile(escaping, taskDir)).rejects.toThrow(
				"Task file must be within the task directory",
			);
			await expect(stat(path.resolve(escaping))).rejects.toThrow();
		});
	});

	it("refuses the task directory itself", async () => {
		await withTaskDir(async (taskDir) => {
			await expect(setupTaskFile(taskDir, taskDir)).rejects.toThrow(
				"Task file must be within the task directory",
			);
		});
	});

	it("refuses a relative task directory", async () => {
		await expect(
			setupTaskFile("mise-tasks/build", "mise-tasks"),
		).rejects.toThrow("Task directory must be an absolute path");
	});
});

describe("isPathInside", () => {
	const root = path.resolve("/repo/project");

	it("accepts a path nested in the directory", () => {
		expect(isPathInside(root, path.join(root, "bin", "mise"))).toBe(true);
		expect(isPathInside(root, path.join(root, "mise"))).toBe(true);
	});

	it("rejects the directory itself", () => {
		expect(isPathInside(root, root)).toBe(false);
	});

	it("rejects paths outside the directory", () => {
		expect(isPathInside(root, path.resolve("/repo/other/mise"))).toBe(false);
		expect(isPathInside(root, path.resolve("/usr/local/bin/mise"))).toBe(false);
		expect(isPathInside(root, path.join(root, "..", "mise"))).toBe(false);
	});

	it("is not fooled by a sibling sharing the directory prefix", () => {
		expect(isPathInside(root, path.resolve("/repo/project-evil/mise"))).toBe(
			false,
		);
	});
});

describe("isBareCommand", () => {
	it("recognises a command name looked up in PATH", () => {
		expect(isBareCommand("mise")).toBe(true);
		expect(isBareCommand("mise.exe")).toBe(true);
	});

	it("rejects anything holding a path separator", () => {
		expect(isBareCommand("./mise")).toBe(false);
		expect(isBareCommand("bin/mise")).toBe(false);
		expect(isBareCommand("/usr/local/bin/mise")).toBe(false);
		expect(isBareCommand("bin\\mise.exe")).toBe(false);
	});
});

describe("locateCommand", () => {
	const workspace = path.resolve("/repo/project");
	const existsIn = (...paths: string[]) => {
		return (filePath: string) => paths.includes(filePath);
	};
	const pathEnv = ["/usr/local/bin", "/usr/bin"]
		.map((directory) => path.resolve(directory))
		.join(path.delimiter);

	it("finds the command in the first PATH directory holding it", () => {
		expect(
			locateCommand("mise", {
				cwds: [workspace],
				pathEnv,
				windows: false,
				exists: existsIn(
					path.resolve("/usr/bin/mise"),
					path.resolve("/usr/local/bin/mise"),
				),
			}),
		).toBe(path.resolve("/usr/local/bin/mise"));
	});

	// the default `mise.binPath` is a bare name: with `code .` the working
	// directory is the workspace, but nothing runs from there on POSIX (#298)
	it("ignores the working directory on POSIX", () => {
		expect(
			locateCommand("mise", {
				cwds: [workspace],
				pathEnv,
				windows: false,
				exists: existsIn(path.join(workspace, "mise")),
			}),
		).toBeUndefined();
	});

	it("returns undefined when no directory holds the command", () => {
		expect(
			locateCommand("mise", {
				cwds: [workspace],
				pathEnv,
				windows: false,
				exists: existsIn(),
			}),
		).toBeUndefined();
	});

	it("skips empty PATH entries", () => {
		expect(
			locateCommand("mise", {
				pathEnv: `${path.delimiter}${pathEnv}${path.delimiter}`,
				windows: false,
				exists: existsIn(path.resolve("/usr/bin/mise")),
			}),
		).toBe(path.resolve("/usr/bin/mise"));
	});

	it("checks the working directories before PATH on Windows", () => {
		expect(
			locateCommand("mise", {
				cwds: [workspace],
				pathEnv,
				windows: true,
				exists: existsIn(
					path.join(workspace, "mise.exe"),
					path.resolve("/usr/local/bin/mise.exe"),
				),
			}),
		).toBe(path.join(workspace, "mise.exe"));
	});

	it("tries the .com and .exe extensions on Windows", () => {
		expect(
			locateCommand("mise", {
				pathEnv,
				windows: true,
				exists: existsIn(path.resolve("/usr/bin/mise.com")),
			}),
		).toBe(path.resolve("/usr/bin/mise.com"));
		expect(
			locateCommand("mise.exe", {
				pathEnv,
				windows: true,
				exists: existsIn(path.resolve("/usr/bin/mise.exe")),
			}),
		).toBe(path.resolve("/usr/bin/mise.exe"));
	});

	it("does not start a file without extension on Windows", () => {
		expect(
			locateCommand("mise", {
				cwds: [workspace],
				pathEnv,
				windows: true,
				exists: existsIn(path.join(workspace, "mise")),
			}),
		).toBeUndefined();
	});
});

describe("collapseHomePath", () => {
	it("rewrites a path inside the home directory to its ~ form", () => {
		expect(collapseHomePath(path.join(homedir(), ".config", "app.conf"))).toBe(
			"~/.config/app.conf",
		);
	});

	it("round-trips with expandPath", () => {
		const collapsed = collapseHomePath(path.join(homedir(), "src", "repo"));
		expect(collapsed).toBeDefined();
		expect(expandPath(collapsed as string)).toBe(
			expandPath(path.join(homedir(), "src", "repo")),
		);
	});

	it("returns undefined when there is nothing to collapse", () => {
		// mise reports bootstrap resource paths expanded; anything outside the
		// home directory (or already using ~) has no second form to look up
		expect(collapseHomePath("/etc/example/app.conf")).toBeUndefined();
		expect(collapseHomePath("~/.config/app.conf")).toBeUndefined();
		expect(collapseHomePath(homedir())).toBeUndefined();
		expect(collapseHomePath("brew:jq")).toBeUndefined();
	});

	it("is not fooled by a sibling sharing the home directory prefix", () => {
		expect(collapseHomePath(`${homedir()}-backup/app.conf`)).toBeUndefined();
	});
});
