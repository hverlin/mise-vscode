import path from "node:path";
import { expandPath } from "./fileUtils";

/** the format `mise lock` writes for a new lockfile (mise 2026.9.16+) */
export const LATEST_LOCKFILE_FORMAT = 3;

/** the flags a lens runs `mise lock` with */
export const LOCK_FLAGS: unknown[] = ["--local", "--bump", "--upgrade"];
export type LockFlag = "--local" | "--bump" | "--upgrade";

/** an entry of `mise lock --dry-run --json`: a tool whose locked versions change */
export type LockfileChange = {
	name: string;
	backend: string;
	lockfile: string;
	old_versions: string[];
	new_versions: string[];
};

/**
 * `mise.lock`, or `mise.local.lock` for the tools of `mise.local.toml` (which
 * `mise lock --local` updates). Undefined for the lockfiles of an environment,
 * such as `mise.test.lock`, which this does not handle.
 */
export function getLockfileKind(
	filePath: string,
): { local: boolean } | undefined {
	switch (path.basename(filePath)) {
		case "mise.lock":
			return { local: false };
		case "mise.local.lock":
			return { local: true };
		default:
			return undefined;
	}
}

/**
 * The lockfile the tools of a config file go to: `mise.lock` next to it, or
 * `mise.local.lock` for a local config. The fragments of a `conf.d` directory
 * share the one of its parent directory. Undefined for the config of an
 * environment, such as `mise.test.toml`, and for other files.
 */
export function getExpectedLockfile(configPath: string): string | undefined {
	const name = path.basename(configPath);
	const dir = path.dirname(configPath);
	if (path.basename(dir) === "conf.d" && name.endsWith(".toml")) {
		return path.join(path.dirname(dir), "mise.lock");
	}
	if (/^\.?mise\.local\.toml$|^config\.local\.toml$/.test(name)) {
		return path.join(dir, "mise.local.lock");
	}
	if (/^\.?mise\.toml$|^config\.toml$/.test(name)) {
		return path.join(dir, "mise.lock");
	}
	return undefined;
}

/** `lockfile_version` of a lockfile; 0 for the files written before it */
export function getLockfileFormat(source: string): number {
	const version = /^\s*lockfile_version\s*=\s*(\d+)/m.exec(source)?.[1];
	return version ? Number(version) : 0;
}

/** the changes of a lockfile, out of those of every lockfile of a project */
export function getChangesOfLockfile(
	changes: LockfileChange[],
	lockfilePath: string,
): LockfileChange[] {
	const lockfile = expandPath(lockfilePath);
	return changes.filter((change) => expandPath(change.lockfile) === lockfile);
}

/**
 * What `mise lock --bump` changes on top of `mise lock`: the newer versions of
 * the tools locked already. The bump repeats the other changes, the tools
 * added to or removed from the config.
 */
export function getBumps(
	bumpChanges: LockfileChange[],
	changes: LockfileChange[],
): LockfileChange[] {
	const changed = new Set(changes.map((change) => change.name));
	return bumpChanges.filter(
		(change) =>
			change.old_versions.length > 0 &&
			change.new_versions.length > 0 &&
			change.old_versions.join() !== change.new_versions.join() &&
			!changed.has(change.name),
	);
}

/** `node 24.21.0 → 22.22.0`, `yq (new) 4.52.4`, `jq (removed)` */
export function formatLockfileChange(change: LockfileChange): string {
	const oldVersions = change.old_versions.join(", ");
	const newVersions = change.new_versions.join(", ");
	if (!oldVersions) {
		return `${change.name} (new) ${newVersions}`;
	}
	if (!newVersions) {
		return `${change.name} (removed)`;
	}
	return `${change.name} ${oldVersions} → ${newVersions}`;
}

/** `1 tool`, `3 tools` */
export function countTools(count: number): string {
	return `${count} ${count === 1 ? "tool" : "tools"}`;
}

/**
 * The confirmation a lens asks before running `mise lock`: the question, what
 * the command does, and the button that runs it
 */
export function describeLockCommand(
	flags: LockFlag[],
	lockfileName: string,
	exists: boolean,
): { question: string; detail: string; action: string; warning: boolean } {
	const alsoLocal = flags.includes("--local")
		? ""
		: " It also updates mise.local.lock, for the tools of mise.local.toml.";
	if (flags.includes("--upgrade")) {
		return {
			question: `Upgrade ${lockfileName} to format ${LATEST_LOCKFILE_FORMAT}?`,
			detail: `Everyone who reads it, CI included, then needs mise 2026.9.16 or newer.${alsoLocal}`,
			action: "Upgrade",
			warning: true,
		};
	}
	if (flags.includes("--bump")) {
		return {
			question: `Bump the versions locked in ${lockfileName}?`,
			detail: `It moves them to the newest versions the config allows, without installing them.${alsoLocal}`,
			action: "Bump",
			warning: false,
		};
	}
	if (!exists) {
		return {
			question: `Create ${lockfileName}?`,
			detail: `It records the versions of the tools of the config, without installing them.${alsoLocal}`,
			action: "Create",
			warning: false,
		};
	}
	return {
		question: `Update ${lockfileName}?`,
		detail: `It adds, updates and removes the entries of the tools of the config, without installing them.${alsoLocal}`,
		action: "Update",
		warning: false,
	};
}
