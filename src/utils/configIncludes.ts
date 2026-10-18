import os from "node:os";
import path from "node:path";
import { expandPath } from "./fileUtils";

/** `git::...`, `oci::...`, or a URL: mise fetches those into its cache */
const REMOTE_INCLUDE = /^(?:[a-z][a-z0-9+.-]*::|[a-z][a-z0-9+.-]*:\/\/)/i;

/**
 * The local files a config merges with `include = [...]` (mise 2026.10.6+),
 * resolved from the directory of the config. Templated paths are left out,
 * they only resolve once mise renders them.
 */
export function getLocalIncludePaths(
	configPath: string,
	config: unknown,
): string[] {
	const include = (config as { include?: unknown } | undefined)?.include;
	const entries = Array.isArray(include) ? include : [include];
	return entries
		.filter(
			(entry): entry is string =>
				typeof entry === "string" &&
				entry.trim() !== "" &&
				!REMOTE_INCLUDE.test(entry) &&
				!entry.includes("{{"),
		)
		.map((entry) =>
			expandPath(
				path.resolve(
					path.dirname(configPath),
					entry.replace(/^~(?=\/|\\|$)/, os.homedir()),
				),
			),
		);
}

/**
 * Every file merged by the configs, includes of includes too. mise reports
 * their content as coming from the config including them, so they are not
 * among the files it lists. `readConfig` returns the parsed file, or undefined
 * when it cannot be read.
 */
export async function collectLocalIncludes(
	configPaths: string[],
	readConfig: (filePath: string) => Promise<unknown>,
): Promise<string[]> {
	const seen = new Set(configPaths.map((configPath) => expandPath(configPath)));
	const includes: string[] = [];
	let pending = [...seen];

	while (pending.length) {
		const configs = await Promise.all(
			pending.map(async (configPath) => ({
				configPath,
				config: await readConfig(configPath),
			})),
		);
		pending = [];
		for (const { configPath, config } of configs) {
			for (const include of getLocalIncludePaths(configPath, config)) {
				if (!seen.has(include)) {
					seen.add(include);
					includes.push(include);
					pending.push(include);
				}
			}
		}
	}

	return includes;
}
