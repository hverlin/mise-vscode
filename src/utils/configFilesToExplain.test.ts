import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
	expandConfigRoots,
	getMonorepoConfigRoots,
	getTaskIncludes,
	isTaskInclude,
} from "./configFilesToExplain";

const root = path.join(path.sep, "repo", "backend");

describe("getTaskIncludes", () => {
	it("keeps the local entries mise reads from disk", () => {
		expect(
			getTaskIncludes({
				task_config: {
					includes: [
						"mise.tasks.toml",
						"tasks/",
						"git::https://github.com/acme/tasks//tasks.toml",
						"oci::ghcr.io/acme/tasks:1",
						"{{ vars.tasks }}.toml",
						"",
						1,
					],
				},
			}),
		).toEqual(["mise.tasks.toml", "tasks/"]);
		expect(getTaskIncludes({ tools: {} })).toEqual([]);
		expect(getTaskIncludes(undefined)).toEqual([]);
	});
});

describe("getMonorepoConfigRoots", () => {
	it("reads [monorepo] config_roots", () => {
		expect(
			getMonorepoConfigRoots({
				monorepo: { config_roots: ["projects/*", "go/{{ vars.x }}"] },
			}),
		).toEqual(["projects/*"]);
		expect(getMonorepoConfigRoots({})).toEqual([]);
	});
});

describe("isTaskInclude", () => {
	it("matches an included file, a file of an included directory, or a glob", () => {
		const file = (relative: string) => path.join(root, ...relative.split("/"));
		expect(
			isTaskInclude(file("mise.tasks.toml"), root, ["mise.tasks.toml"]),
		).toBe(true);
		expect(
			isTaskInclude(file("mise.tasks.toml"), root, ["./mise.tasks.toml"]),
		).toBe(true);
		expect(isTaskInclude(file("tasks/mise.ci.toml"), root, ["tasks/"])).toBe(
			true,
		);
		expect(isTaskInclude(file("mise.build.toml"), root, ["mise.*.toml"])).toBe(
			true,
		);
		expect(
			isTaskInclude(file("a/b/mise.x.toml"), root, ["a/**/mise.*.toml"]),
		).toBe(true);
	});

	it("leaves the other files alone", () => {
		const file = (relative: string) => path.join(root, ...relative.split("/"));
		expect(isTaskInclude(file("mise.ci.toml"), root, ["mise.tasks.toml"])).toBe(
			false,
		);
		expect(isTaskInclude(file("tasksx/mise.a.toml"), root, ["tasks"])).toBe(
			false,
		);
		expect(isTaskInclude(file("a/mise.b.toml"), root, ["mise.*.toml"])).toBe(
			false,
		);
		// outside the config root
		expect(
			isTaskInclude(path.join(path.sep, "repo", "mise.tasks.toml"), root, [
				"../mise.tasks.toml",
			]),
		).toBe(false);
		expect(isTaskInclude(file("mise.tasks.toml"), root, [])).toBe(false);
	});
});

describe("expandConfigRoots", () => {
	const tree: Record<string, string[]> = {
		[path.join(path.sep, "repo")]: ["projects", "go", "docs"],
		[path.join(path.sep, "repo", "projects")]: ["api", "web"],
		[path.join(path.sep, "repo", "go")]: ["gateway", "auth"],
	};
	const listDirectories = async (directory: string) => tree[directory] ?? [];
	const repo = path.join(path.sep, "repo");

	it("expands the globs of a single directory level", async () => {
		expect(
			await expandConfigRoots(
				repo,
				["projects/*", "go/g*", "docs", "projects/api", "."],
				listDirectories,
			),
		).toEqual([
			path.join(repo, "projects", "api"),
			path.join(repo, "projects", "web"),
			path.join(repo, "go", "gateway"),
			path.join(repo, "docs"),
		]);
	});
});
