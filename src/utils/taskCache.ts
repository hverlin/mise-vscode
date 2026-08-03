/**
 * Helpers for the experimental task output cache
 * (https://mise.jdx.dev/tasks/task-configuration.html#cache).
 */

import type { MiseTomlType } from "./miseFileParser";

export type TaskCacheDeclaration = {
	enabled: boolean;
	/**
	 * Command inputs run whenever mise computes the cache key of the task, so
	 * the extension must not compute it on their behalf.
	 */
	hasCommandInputs: boolean;
};

/**
 * The `cache` table of every task of a document, by task name. Inline tables
 * (`cache = { enabled = true }`) and `[tasks.<name>.cache]` sections parse to
 * the same shape.
 */
export function findTaskCacheDeclarations(
	parsed: MiseTomlType,
): Map<string, TaskCacheDeclaration> {
	const declarations = new Map<string, TaskCacheDeclaration>();
	for (const [name, task] of Object.entries(parsed.tasks ?? {})) {
		if (typeof task !== "object" || task === null) {
			continue;
		}
		const cache = (task as { cache?: unknown }).cache;
		if (typeof cache !== "object" || cache === null) {
			continue;
		}

		const { enabled, command_inputs: commandInputs } = cache as {
			enabled?: unknown;
			command_inputs?: unknown;
		};
		declarations.set(name, {
			enabled: enabled === true,
			hasCommandInputs:
				Array.isArray(commandInputs) && commandInputs.length > 0,
		});
	}
	return declarations;
}

/** Names of the tasks that opt into the output cache */
export function findCacheEnabledTasks(parsed: MiseTomlType): Set<string> {
	const cacheEnabled = new Set<string>();
	for (const [name, declaration] of findTaskCacheDeclarations(parsed)) {
		if (declaration.enabled) {
			cacheEnabled.add(name);
		}
	}
	return cacheEnabled;
}

export function totalCacheSize(entries: MiseTaskCacheEntry[]): number {
	return entries.reduce((total, entry) => total + (entry.size_bytes ?? 0), 0);
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 B";
	}

	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	// bytes are always whole, larger units keep one decimal
	const rounded = unitIndex === 0 ? value : Math.round(value * 10) / 10;
	return `${rounded} ${SIZE_UNITS[unitIndex]}`;
}

/** Execution durations are reported in nanoseconds */
export function formatDuration(nanoseconds: number): string {
	if (!Number.isFinite(nanoseconds) || nanoseconds <= 0) {
		return "0ms";
	}

	const milliseconds = nanoseconds / 1_000_000;
	if (milliseconds < 1000) {
		return `${Math.round(milliseconds)}ms`;
	}

	const seconds = milliseconds / 1000;
	if (seconds < 60) {
		return `${Math.round(seconds * 10) / 10}s`;
	}

	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

/** `last_accessed` is a unix timestamp in seconds */
export function formatLastAccessed(
	unixSeconds: number,
	now: Date = new Date(),
): string {
	const elapsedSeconds = Math.floor(now.getTime() / 1000) - unixSeconds;
	if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 60) {
		return "just now";
	}
	if (elapsedSeconds < 3600) {
		const minutes = Math.floor(elapsedSeconds / 60);
		return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	}
	if (elapsedSeconds < 86400) {
		const hours = Math.floor(elapsedSeconds / 3600);
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	const days = Math.floor(elapsedSeconds / 86400);
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Summary of a task's cache entries, e.g. `2 entries · 1.2 KB` */
export function formatCacheSummary(entries: MiseTaskCacheEntry[]): string {
	if (entries.length === 0) {
		return "no entries";
	}
	const size = formatBytes(totalCacheSize(entries));
	return `${entries.length} ${entries.length === 1 ? "entry" : "entries"} · ${size}`;
}
