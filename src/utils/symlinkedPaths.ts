import { realpathSync } from "node:fs";
import * as path from "node:path";
import { isWindows } from "./fileUtils";

/** A folder as vscode opened it, and the real path mise knows it by */
export type PathMapping = { realPath: string; openedPath: string };

/**
 * mise runs in the workspace folder, and the working directory of a process
 * has its symlinks resolved: every path mise reports goes through the real
 * folders (`/private/tmp/project` for a project opened as `/tmp/project` on
 * macOS). vscode keeps the path the folder was opened with, so the two never
 * compare equal.
 *
 * Maps the real path of each folder, and of each of its parents (mise reads
 * their config files too), back to the opened path. Only the paths that go
 * through a symlink are mapped, longest real path first.
 */
export function getSymlinkedPathMappings(
	folders: string[],
	realpath: (filePath: string) => string = realpathSync.native,
): PathMapping[] {
	const mappings = new Map<string, string>();
	for (const folder of folders) {
		let current = path.resolve(folder);
		while (true) {
			let realPath: string | undefined;
			try {
				realPath = realpath(current);
			} catch {
				realPath = undefined;
			}
			const isSymlinked =
				realPath !== undefined &&
				(isWindows
					? realPath.toLowerCase() !== current.toLowerCase()
					: realPath !== current);
			if (realPath && isSymlinked && !mappings.has(realPath)) {
				mappings.set(realPath, current);
			}

			const parent = path.dirname(current);
			if (parent === current) {
				break;
			}
			current = parent;
		}
	}

	return [...mappings]
		.map(([realPath, openedPath]) => ({ realPath, openedPath }))
		.sort((a, b) => b.realPath.length - a.realPath.length);
}

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** the form a path takes inside a JSON string, backslashes escaped */
const jsonEscaped = (value: string) => JSON.stringify(value).slice(1, -1);

/**
 * Rewrites the real paths of {@link getSymlinkedPathMappings} in mise output
 * to the paths vscode opened, in plain text and in JSON alike.
 */
export function toOpenedPaths(output: string, mappings: PathMapping[]): string {
	if (!output || mappings.length === 0) {
		return output;
	}

	const replacements = new Map<string, string>();
	for (const { realPath, openedPath } of mappings) {
		replacements.set(realPath, openedPath);
		replacements.set(jsonEscaped(realPath), jsonEscaped(openedPath));
	}

	// a whole path, not the start of a longer name: `/private/tmp/project` is
	// not in `/private/tmp/project-2`
	const pattern = new RegExp(
		`(${[...replacements.keys()]
			.sort((a, b) => b.length - a.length)
			.map(escapeRegExp)
			.join("|")})(?![^\\\\/"'\\s:,;)\\]}])`,
		"g",
	);
	return output.replace(pattern, (match) => replacements.get(match) ?? match);
}
