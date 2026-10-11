import { describe, expect, it } from "bun:test";
import {
	getSymlinkedPathMappings,
	type PathMapping,
	toOpenedPaths,
} from "./symlinkedPaths";

/** macOS: /tmp and /var are symlinks to /private/tmp and /private/var */
const macRealpath = (filePath: string) =>
	filePath.replace(/^\/(tmp|var)(?=\/|$)/, "/private/$1");

describe("getSymlinkedPathMappings", () => {
	it("maps a folder and its parents opened through a symlink", () => {
		expect(
			getSymlinkedPathMappings(["/tmp/tests/project"], macRealpath),
		).toEqual([
			{
				realPath: "/private/tmp/tests/project",
				openedPath: "/tmp/tests/project",
			},
			{ realPath: "/private/tmp/tests", openedPath: "/tmp/tests" },
			{ realPath: "/private/tmp", openedPath: "/tmp" },
		]);
	});

	it("maps nothing for a folder without symlinks", () => {
		expect(getSymlinkedPathMappings(["/home/me/project"], macRealpath)).toEqual(
			[],
		);
	});

	it("follows a symlink in the middle of the path", () => {
		const realpath = (filePath: string) =>
			filePath.replace(/^\/home\/me\/code(?=\/|$)/, "/data/code");

		expect(getSymlinkedPathMappings(["/home/me/code/app"], realpath)).toEqual([
			{ realPath: "/data/code/app", openedPath: "/home/me/code/app" },
			{ realPath: "/data/code", openedPath: "/home/me/code" },
		]);
	});

	it("skips the folders that cannot be resolved", () => {
		const realpath = (filePath: string) => {
			if (filePath.startsWith("/tmp/gone")) {
				throw new Error("ENOENT");
			}
			return macRealpath(filePath);
		};

		expect(getSymlinkedPathMappings(["/tmp/gone"], realpath)).toEqual([
			{ realPath: "/private/tmp", openedPath: "/tmp" },
		]);
	});
});

describe("toOpenedPaths", () => {
	const mappings: PathMapping[] = getSymlinkedPathMappings(
		["/tmp/tests/project"],
		macRealpath,
	);

	it("rewrites the paths of a JSON output", () => {
		const output = JSON.stringify([
			{ path: "/private/tmp/tests/project/mise.toml", tools: [] },
			{ path: "/private/tmp/tests/mise.toml", tools: [] },
			{ path: "/home/me/.config/mise/config.toml", tools: [] },
		]);

		expect(JSON.parse(toOpenedPaths(output, mappings))).toEqual([
			{ path: "/tmp/tests/project/mise.toml", tools: [] },
			{ path: "/tmp/tests/mise.toml", tools: [] },
			{ path: "/home/me/.config/mise/config.toml", tools: [] },
		]);
	});

	it("rewrites the paths of a text output", () => {
		expect(
			toOpenedPaths(
				"mise ERROR error parsing config file: /private/tmp/tests/project/mise.toml",
				mappings,
			),
		).toBe(
			"mise ERROR error parsing config file: /tmp/tests/project/mise.toml",
		);
		expect(toOpenedPaths("/private/tmp/tests/project: trusted", mappings)).toBe(
			"/tmp/tests/project: trusted",
		);
	});

	it("only rewrites whole path segments", () => {
		expect(
			toOpenedPaths("/private/tmp/tests/project-2/mise.toml", mappings),
		).toBe("/tmp/tests/project-2/mise.toml");
		expect(toOpenedPaths("/private/tmpfoo/mise.toml", mappings)).toBe(
			"/private/tmpfoo/mise.toml",
		);
	});

	it("rewrites escaped Windows paths in JSON", () => {
		const windowsMappings: PathMapping[] = [
			{ realPath: "d:\\code\\app", openedPath: "c:\\users\\me\\app" },
		];
		const output = JSON.stringify({ source: "d:\\code\\app\\mise.toml" });

		expect(JSON.parse(toOpenedPaths(output, windowsMappings))).toEqual({
			source: "c:\\users\\me\\app\\mise.toml",
		});
	});

	it("returns the output as is without mappings", () => {
		expect(toOpenedPaths("/private/tmp/a", [])).toBe("/private/tmp/a");
	});

	it("rewrites the paths mise writes with ~", () => {
		const homeMappings = getSymlinkedPathMappings(
			["/home/me/link/project"],
			(filePath) =>
				filePath.replace(/^\/home\/me\/link(?=\/|$)/, "/home/me/real"),
		);

		expect(
			toOpenedPaths(
				"Config files in ~/real/project/mise.toml are not trusted.",
				homeMappings,
				"/home/me",
			),
		).toBe("Config files in ~/link/project/mise.toml are not trusted.");
	});
});
