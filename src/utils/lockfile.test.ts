import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
	countTools,
	describeLockCommand,
	formatLockfileChange,
	getBumps,
	getChangesOfLockfile,
	getExpectedLockfile,
	getLockfileFormat,
	getLockfileKind,
	type LockfileChange,
} from "./lockfile";

const project = path.join(path.sep, "projects", "app");
const lockfile = path.join(project, "mise.lock");
const localLockfile = path.join(project, "mise.local.lock");

const change = (
	name: string,
	oldVersions: string[],
	newVersions: string[],
	file = lockfile,
): LockfileChange => ({
	name,
	backend: `aqua:${name}`,
	lockfile: file,
	old_versions: oldVersions,
	new_versions: newVersions,
});

describe("getLockfileKind", () => {
	it("knows the project and local lockfiles", () => {
		expect(getLockfileKind(lockfile)).toEqual({ local: false });
		expect(getLockfileKind(path.join(project, ".config", "mise.lock"))).toEqual(
			{ local: false },
		);
		expect(getLockfileKind(localLockfile)).toEqual({ local: true });
	});

	it("leaves out the lockfiles of an environment and other files", () => {
		expect(
			getLockfileKind(path.join(project, "mise.test.lock")),
		).toBeUndefined();
		expect(getLockfileKind(path.join(project, "bun.lock"))).toBeUndefined();
		expect(getLockfileKind(path.join(project, "mise.toml"))).toBeUndefined();
	});
});

describe("getExpectedLockfile", () => {
	it("is mise.lock next to the config, mise.local.lock for a local one", () => {
		const cases: [string, string][] = [
			["mise.toml", "mise.lock"],
			[".mise.toml", "mise.lock"],
			["mise.local.toml", "mise.local.lock"],
			[".mise.local.toml", "mise.local.lock"],
			[path.join(".config", "mise.toml"), path.join(".config", "mise.lock")],
			[
				path.join(".config", "mise", "config.toml"),
				path.join(".config", "mise", "mise.lock"),
			],
			[
				path.join(".config", "mise", "config.local.toml"),
				path.join(".config", "mise", "mise.local.lock"),
			],
			// the fragments share the lockfile of their parent directory
			[
				path.join(".config", "mise", "conf.d", "tools.toml"),
				path.join(".config", "mise", "mise.lock"),
			],
		];
		for (const [configFile, lockfileFile] of cases) {
			expect(getExpectedLockfile(path.join(project, configFile))).toBe(
				path.join(project, lockfileFile),
			);
		}
	});

	it("is undefined for the config of an environment and other files", () => {
		for (const file of [
			"mise.test.toml",
			"mise.test.local.toml",
			".tool-versions",
			"tasks.toml",
		]) {
			expect(getExpectedLockfile(path.join(project, file))).toBeUndefined();
		}
	});
});

describe("getLockfileFormat", () => {
	it("reads lockfile_version, 0 without it", () => {
		expect(
			getLockfileFormat(
				"# @generated - this file is auto-generated\n\nlockfile_version = 3\n\n[[tools.node]]\n",
			),
		).toBe(3);
		expect(getLockfileFormat('[[tools.node]]\nversion = "24"\n')).toBe(0);
	});
});

describe("getChangesOfLockfile", () => {
	it("keeps the changes of that lockfile", () => {
		const changes = [
			change("node", ["24.21.0"], ["22.22.0"]),
			change("yq", [], ["4.52.4"], localLockfile),
		];
		expect(getChangesOfLockfile(changes, lockfile)).toEqual(
			changes.slice(0, 1),
		);
		expect(getChangesOfLockfile(changes, localLockfile)).toEqual(
			changes.slice(1, 2),
		);
	});
});

describe("getBumps", () => {
	it("keeps the newer versions of the tools locked already", () => {
		const changes = [
			change("node", ["24.21.0"], ["22.22.0"]),
			change("yq", [], ["4.52.4"]),
		];
		const bumps = [
			change("jq", ["1.7.1"], ["1.8.0"]),
			// the changes of any `mise lock`, repeated by the bump
			change("node", ["24.21.0"], ["22.22.0"]),
			change("yq", [], ["4.52.4"]),
			change("fd", ["10.2.0"], []),
			// nothing newer
			change("bun", ["1.4.2"], ["1.4.2"]),
		];
		expect(getBumps(bumps, changes)).toEqual(bumps.slice(0, 1));
	});
});

describe("formatLockfileChange", () => {
	it("describes a new, changed or removed tool", () => {
		expect(formatLockfileChange(change("yq", [], ["4.52.4"]))).toBe(
			"yq (new) 4.52.4",
		);
		expect(formatLockfileChange(change("node", ["24.21.0"], ["22.22.0"]))).toBe(
			"node 24.21.0 → 22.22.0",
		);
		expect(formatLockfileChange(change("jq", ["1.7.1"], []))).toBe(
			"jq (removed)",
		);
	});
});

describe("countTools", () => {
	it("counts in singular or plural", () => {
		expect(countTools(1)).toBe("1 tool");
		expect(countTools(3)).toBe("3 tools");
	});
});

describe("describeLockCommand", () => {
	it("asks before each lock command, warning before a format upgrade", () => {
		expect(describeLockCommand([], "mise.lock", true)).toEqual({
			question: "Update mise.lock?",
			detail:
				"It adds, updates and removes the entries of the tools of the config, without installing them. It also updates mise.local.lock, for the tools of mise.local.toml.",
			action: "Update",
			warning: false,
		});
		expect(describeLockCommand(["--local"], "mise.local.lock", false)).toEqual({
			question: "Create mise.local.lock?",
			detail:
				"It records the versions of the tools of the config, without installing them.",
			action: "Create",
			warning: false,
		});
		expect(describeLockCommand(["--bump"], "mise.lock", true)).toMatchObject({
			question: "Bump the versions locked in mise.lock?",
			action: "Bump",
			warning: false,
		});
		expect(
			describeLockCommand(["--local", "--upgrade"], "mise.local.lock", true),
		).toEqual({
			question: "Upgrade mise.local.lock to format 3?",
			detail:
				"Everyone who reads it, CI included, then needs mise 2026.9.16 or newer.",
			action: "Upgrade",
			warning: true,
		});
	});
});
