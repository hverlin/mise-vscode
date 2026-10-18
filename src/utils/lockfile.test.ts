import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
	countTools,
	formatLockfileChange,
	getChangesOfConfig,
	getChangesOfLockfile,
	getConfigLockfileKind,
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

describe("getConfigLockfileKind", () => {
	it("tells the local config files from the others", () => {
		for (const config of [
			"mise.toml",
			".mise.toml",
			path.join(".config", "mise", "config.toml"),
			path.join("mise", "conf.d", "tools.toml"),
		]) {
			expect(getConfigLockfileKind(path.join(project, config))).toEqual({
				local: false,
			});
		}
		for (const config of [
			"mise.local.toml",
			".mise.local.toml",
			path.join(".config", "mise", "config.local.toml"),
		]) {
			expect(getConfigLockfileKind(path.join(project, config))).toEqual({
				local: true,
			});
		}
	});

	it("leaves out the config files of an environment", () => {
		expect(
			getConfigLockfileKind(path.join(project, "mise.test.toml")),
		).toBeUndefined();
		expect(
			getConfigLockfileKind(path.join(project, "mise.test.local.toml")),
		).toBeUndefined();
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

describe("getChangesOfConfig", () => {
	const changes = [
		change("node", ["24.21.0"], ["22.22.0"]),
		change("aqua:jqlang/jq", [], ["1.7.1"]),
		change("yq", [], ["4.52.4"], localLockfile),
	];

	it("finds the lockfile of the tools of a config and their changes", () => {
		expect(getChangesOfConfig(changes, ["node", "python"], false)).toEqual({
			lockfile,
			changes: changes.slice(0, 1),
		});
		expect(getChangesOfConfig(changes, ["yq"], true)).toEqual({
			lockfile: localLockfile,
			changes: changes.slice(2, 3),
		});
	});

	it("is undefined when the lockfile has every tool of the config", () => {
		expect(getChangesOfConfig(changes, ["python"], false)).toBeUndefined();
		// yq is in mise.local.toml, not in mise.toml
		expect(getChangesOfConfig(changes, ["yq"], false)).toBeUndefined();
		expect(getChangesOfConfig([], ["node"], false)).toBeUndefined();
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
