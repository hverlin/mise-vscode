import { describe, expect, it } from "bun:test";
import type { MiseTomlType } from "./miseFileParser";
import { TomlParser } from "./miseFileParser";
import {
	findCacheEnabledTasks,
	findTaskCacheDeclarations,
	formatBytes,
	formatCacheSummary,
	formatDuration,
	formatLastAccessed,
	totalCacheSize,
} from "./taskCache";

const createEntry = (
	overrides: Partial<MiseTaskCacheEntry> = {},
): MiseTaskCacheEntry => ({
	key: "abc",
	current: true,
	size_bytes: 100,
	restored_bytes: 10,
	execution_duration_ns: 1_000_000,
	last_accessed: 0,
	outputs: ["dist"],
	...overrides,
});

const parseToml = (source: string) =>
	new TomlParser<MiseTomlType>(source).parsed;

describe("findCacheEnabledTasks", () => {
	it("finds inline cache tables", () => {
		const parsed = parseToml(`
[tasks.build]
run = "npm run build"
sources = ["src/**"]
outputs = ["dist"]
cache = { enabled = true }

[tasks.lint]
run = "npm run lint"
`);
		expect([...findCacheEnabledTasks(parsed)]).toEqual(["build"]);
	});

	it("finds nested cache tables", () => {
		const parsed = parseToml(`
[tasks.build]
run = "npm run build"

[tasks.build.cache]
enabled = true
env = ["NODE_ENV"]
`);
		expect([...findCacheEnabledTasks(parsed)]).toEqual(["build"]);
	});

	it("ignores tasks that opt out or do not declare a cache", () => {
		const parsed = parseToml(`
[tasks.build]
run = "npm run build"
cache = { enabled = false }

[tasks.test]
run = "npm test"
cache = { audit = true }

[tasks.lint]
run = "npm run lint"
`);
		expect([...findCacheEnabledTasks(parsed)]).toEqual([]);
	});

	it("ignores string tasks and documents without tasks", () => {
		expect([
			...findCacheEnabledTasks(parseToml(`[tasks]\nbuild = "echo"`)),
		]).toEqual([]);
		expect([
			...findCacheEnabledTasks(parseToml("[tools]\nnode = '22'")),
		]).toEqual([]);
	});
});

describe("findTaskCacheDeclarations", () => {
	// the extension may not compute the cache key of a task with command inputs:
	// mise runs them to do it
	it("reports command inputs, inline or nested", () => {
		const parsed = parseToml(`
[tasks.build]
cache = { enabled = true, command_inputs = ["node --version"] }

[tasks.test]
cache = { enabled = true, command_inputs = [] }

[tasks.lint]
cache = { enabled = true }

[tasks.docs]
[tasks.docs.cache]
enabled = true
command_inputs = ["pnpm config get registry"]
`);

		expect(Object.fromEntries(findTaskCacheDeclarations(parsed))).toEqual({
			build: { enabled: true, hasCommandInputs: true },
			test: { enabled: true, hasCommandInputs: false },
			lint: { enabled: true, hasCommandInputs: false },
			docs: { enabled: true, hasCommandInputs: true },
		});
	});

	it("keeps declarations of tasks that opted out", () => {
		const parsed = parseToml(`
[tasks.build]
cache = { enabled = false, command_inputs = ["node --version"] }
`);

		expect(findTaskCacheDeclarations(parsed).get("build")).toEqual({
			enabled: false,
			hasCommandInputs: true,
		});
	});

	it("ignores tasks without a cache table", () => {
		expect(
			findTaskCacheDeclarations(parseToml(`[tasks.build]\nrun = "echo"`)).size,
		).toBe(0);
	});
});

describe("formatBytes", () => {
	it("keeps bytes whole and larger units to one decimal", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(463)).toBe("463 B");
		expect(formatBytes(1024)).toBe("1 KB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
	});

	it("is defensive about missing values", () => {
		expect(formatBytes(Number.NaN)).toBe("0 B");
		expect(formatBytes(-1)).toBe("0 B");
	});
});

describe("formatDuration", () => {
	it("formats nanoseconds by magnitude", () => {
		expect(formatDuration(20_706_166)).toBe("21ms");
		expect(formatDuration(1_500_000_000)).toBe("1.5s");
		expect(formatDuration(90_000_000_000)).toBe("1m 30s");
		expect(formatDuration(0)).toBe("0ms");
	});
});

describe("formatLastAccessed", () => {
	const now = new Date("2026-08-03T12:00:00Z");
	const at = (secondsAgo: number) =>
		formatLastAccessed(Math.floor(now.getTime() / 1000) - secondsAgo, now);

	it("formats relative times", () => {
		expect(at(5)).toBe("just now");
		expect(at(60)).toBe("1 minute ago");
		expect(at(600)).toBe("10 minutes ago");
		expect(at(7200)).toBe("2 hours ago");
		expect(at(172_800)).toBe("2 days ago");
	});
});

describe("cache summaries", () => {
	it("sums entry sizes", () => {
		expect(
			totalCacheSize([
				createEntry({ size_bytes: 100 }),
				createEntry({ size_bytes: 24 }),
			]),
		).toBe(124);
		expect(totalCacheSize([])).toBe(0);
	});

	it("summarizes entries", () => {
		expect(formatCacheSummary([])).toBe("no entries");
		expect(formatCacheSummary([createEntry({ size_bytes: 463 })])).toBe(
			"1 entry · 463 B",
		);
		expect(
			formatCacheSummary([
				createEntry({ size_bytes: 512 }),
				createEntry({ size_bytes: 512 }),
			]),
		).toBe("2 entries · 1 KB");
	});
});
