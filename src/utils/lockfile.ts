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
 * The lockfile of the tools of a config file, by its name: `mise.local.toml`
 * writes to `mise.local.lock`. Undefined for the config of an environment,
 * such as `mise.test.toml`.
 */
export function getConfigLockfileKind(
	configPath: string,
): { local: boolean } | undefined {
	const name = path.basename(configPath);
	if (/^\.?mise\.local\.toml$|^config\.local\.toml$/.test(name)) {
		return { local: true };
	}
	if (
		/^\.?mise\.toml$|^config\.toml$/.test(name) ||
		path.basename(path.dirname(configPath)) === "conf.d"
	) {
		return { local: false };
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
 * The changes to the tools a config file declares, and the lockfile they go
 * to. Undefined when the lockfile has all of them.
 */
export function getChangesOfConfig(
	changes: LockfileChange[],
	toolNames: string[],
	local: boolean,
): { lockfile: string; changes: LockfileChange[] } | undefined {
	const configChanges = changes.filter(
		(change) =>
			toolNames.includes(change.name) &&
			(getLockfileKind(change.lockfile)?.local ?? false) === local,
	);
	const lockfile = configChanges[0]?.lockfile;
	if (!lockfile) {
		return undefined;
	}
	return {
		lockfile,
		changes: getChangesOfLockfile(configChanges, lockfile),
	};
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
