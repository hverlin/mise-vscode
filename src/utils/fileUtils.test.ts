import { describe, expect, it } from "bun:test";
import {
	compareSourcePaths,
	getShebangFileExtension,
	getSourceProximityRank,
	resolveConfiguredBinPath,
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
