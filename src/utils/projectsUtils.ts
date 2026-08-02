import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

export type MiseConfigWithTools = {
	path: string;
	tools: Record<string, unknown>;
};

/**
 * mise-native config file names: `mise.toml`, `.mise.toml`, `mise.local.toml`,
 * `mise.<env>.toml`, `.tool-versions`, and `config[.<env>][.local].toml` when
 * placed inside a `mise`/`.mise` directory.
 */
export function isMiseNativeConfigPath(filePath: string): boolean {
	const base = path.basename(filePath);
	if (base === ".tool-versions") {
		return true;
	}
	if (/^\.?mise(\.[\w-]+)*\.toml$/.test(base)) {
		return true;
	}
	if (/^config(\.[\w-]+)*\.toml$/.test(base)) {
		const parent = path.basename(path.dirname(filePath));
		return parent === "mise" || parent === ".mise";
	}
	return false;
}

/**
 * Directory of the project a config file belongs to. Configs nested in
 * `mise/`, `.mise/` or `.config/mise/` belong to the directory holding that
 * folder, not the folder itself.
 */
export function getProjectRootFromConfigPath(filePath: string): string {
	let dir = path.dirname(filePath);
	const parent = path.basename(dir);
	if (parent === "mise" || parent === ".mise") {
		dir = path.dirname(dir);
		if (path.basename(dir) === ".config") {
			dir = path.dirname(dir);
		}
	}
	return dir;
}

/** Output shape of `mise ls --all-sources --json` */
export type MiseLsAllSourcesOutput = Record<
	string,
	Array<{
		version: string;
		installed?: boolean;
		sources?: Array<{ type: string; path: string; requested_version: string }>;
	}>
>;

/**
 * Regroup `mise ls --all-sources --json` (tool -> versions -> sources) into
 * per-config-file tool records. Tool values keep the resolved version and
 * install state so `buildProjectEntries` can surface them.
 */
export function configsFromLsAllSources(
	output: MiseLsAllSourcesOutput,
): MiseConfigWithTools[] {
	const toolsByPath = new Map<string, Record<string, unknown>>();
	for (const [toolName, toolVersions] of Object.entries(output)) {
		for (const toolVersion of toolVersions) {
			for (const source of toolVersion.sources ?? []) {
				const tools = toolsByPath.get(source.path) ?? {};
				const existing = tools[toolName] as { version: string } | undefined;
				tools[toolName] = {
					// the same config can request several versions of one tool
					version: existing
						? `${existing.version}, ${source.requested_version}`
						: source.requested_version,
					resolvedVersion: toolVersion.version,
					installed: toolVersion.installed,
				};
				toolsByPath.set(source.path, tools);
			}
		}
	}
	return [...toolsByPath.entries()].map(([path, tools]) => ({ path, tools }));
}

/** `tools` values in a mise config: string, array, or `{ version: ... }` */
export function formatToolVersion(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((v) => formatToolVersion(v)).join(", ");
	}
	if (value && typeof value === "object" && "version" in value) {
		return formatToolVersion((value as { version: unknown }).version);
	}
	return JSON.stringify(value);
}

/** `node 20.1.0\nruby 3.3` -> { node: "20.1.0", ruby: "3.3" } */
export function parseToolVersionsContent(
	content: string,
): Record<string, string> {
	const tools: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const withoutComment = line.split("#")[0]?.trim();
		if (!withoutComment) {
			continue;
		}
		const [name, ...versions] = withoutComment.split(/\s+/);
		if (name && versions.length > 0) {
			tools[name] = versions.join(" ");
		}
	}
	return tools;
}

/**
 * Later configs override earlier ones when computing a project's effective
 * tools: idiomatic files first, then the base mise config, env-specific
 * configs, and `*.local.toml` last (mirrors mise's own precedence).
 */
function configPrecedence(filePath: string): number {
	const base = path.basename(filePath);
	if (!isMiseNativeConfigPath(filePath)) {
		return 0;
	}
	if (base.includes(".local.")) {
		return 3;
	}
	// mise.<env>.toml / config.<env>.toml have three or more dot-parts
	if (base.replace(/^\./, "").split(".").length > 2) {
		return 2;
	}
	return 1;
}

const SKIPPED_DIRECTORIES = new Set([
	"node_modules",
	".git",
	".hg",
	".svn",
	"dist",
	"build",
	"target",
	"vendor",
]);

/**
 * Recursively find mise-native config files under `dir`. Idiomatic version
 * files are deliberately not collected: matching every `go.mod` or `Gemfile`
 * would list projects that do not use mise at all.
 */
export async function findMiseConfigsInDir(
	dir: string,
	{ maxDepth = 5 }: { maxDepth?: number } = {},
): Promise<string[]> {
	const found: string[] = [];

	const walk = async (currentDir: string, depth: number): Promise<void> => {
		let entries: Dirent[];
		try {
			entries = await fs.readdir(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		const subDirs: string[] = [];
		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isFile()) {
				if (isMiseNativeConfigPath(fullPath)) {
					found.push(fullPath);
				}
			} else if (entry.isDirectory() && depth < maxDepth) {
				if (SKIPPED_DIRECTORIES.has(entry.name)) {
					continue;
				}
				if (
					entry.name.startsWith(".") &&
					entry.name !== ".mise" &&
					entry.name !== ".config"
				) {
					continue;
				}
				subDirs.push(fullPath);
			}
		}

		await Promise.all(subDirs.map((subDir) => walk(subDir, depth + 1)));
	};

	await walk(path.resolve(dir), 0);
	return found.sort();
}

/**
 * Group config files into per-project entries, plus a flat per-file list for
 * the raw view. Configs living in the global config locations
 * (`~/.config/mise`, `~/.mise`, or an explicitly provided global config path)
 * define the global default versions instead of becoming a project; project
 * tools requesting a different version than the global default are flagged
 * with `overridesGlobal`.
 */
export function buildProjectsData(
	configs: MiseConfigWithTools[],
	{
		globalConfigPaths = [],
		homeDir = os.homedir(),
	}: { globalConfigPaths?: string[]; homeDir?: string } = {},
): MiseProjectsData {
	const globalPrefixes = [
		path.join(homeDir, ".config", "mise") + path.sep,
		path.join(homeDir, ".mise") + path.sep,
	];
	const explicitGlobalPaths = new Set(
		globalConfigPaths.map((p) => path.normalize(p)),
	);
	const isGlobalConfig = (configPath: string) => {
		const normalized = path.normalize(configPath);
		return (
			explicitGlobalPaths.has(normalized) ||
			globalPrefixes.some((prefix) => normalized.startsWith(prefix))
		);
	};

	const globalTools: Record<string, string> = {};
	const projectConfigs: MiseConfigWithTools[] = [];
	for (const config of configs) {
		if (isGlobalConfig(config.path)) {
			for (const [name, version] of Object.entries(config.tools ?? {})) {
				globalTools[name] = formatToolVersion(version);
			}
		} else {
			projectConfigs.push(config);
		}
	}

	const configsByRoot = new Map<string, MiseConfigWithTools[]>();
	for (const config of projectConfigs) {
		const rootDir = getProjectRootFromConfigPath(config.path);
		const rootConfigs = configsByRoot.get(rootDir) ?? [];
		rootConfigs.push(config);
		configsByRoot.set(rootDir, rootConfigs);
	}

	const entries: MiseProjectEntry[] = [];
	for (const [rootDir, rootConfigs] of configsByRoot) {
		const sortedConfigs = [...rootConfigs].sort(
			(a, b) =>
				configPrecedence(a.path) - configPrecedence(b.path) ||
				a.path.localeCompare(b.path),
		);

		const toolsByName = new Map<string, MiseProjectTool>();
		for (const config of sortedConfigs) {
			const idiomatic = !isMiseNativeConfigPath(config.path);
			for (const [name, version] of Object.entries(config.tools ?? {})) {
				const formattedVersion = formatToolVersion(version);
				const globalVersion = globalTools[name];
				// values coming from `mise ls --all-sources` carry extra details
				const detail =
					version && typeof version === "object" && !Array.isArray(version)
						? (version as { resolvedVersion?: string; installed?: boolean })
						: undefined;
				toolsByName.set(name, {
					name,
					version: formattedVersion,
					source: config.path,
					idiomatic,
					globalVersion,
					overridesGlobal:
						globalVersion !== undefined && globalVersion !== formattedVersion,
					resolvedVersion: detail?.resolvedVersion,
					installed: detail?.installed,
				});
			}
		}

		entries.push({
			rootDir,
			configs: sortedConfigs.map((config) => ({
				path: config.path,
				idiomatic: !isMiseNativeConfigPath(config.path),
			})),
			tools: [...toolsByName.values()].sort((a, b) =>
				a.name.localeCompare(b.name),
			),
			hasMiseConfig: sortedConfigs.some((config) =>
				isMiseNativeConfigPath(config.path),
			),
		});
	}

	const configFiles = configs
		.map((config) => ({
			path: config.path,
			idiomatic: !isMiseNativeConfigPath(config.path),
			global: isGlobalConfig(config.path),
			tools: Object.fromEntries(
				Object.entries(config.tools ?? {}).map(([name, version]) => [
					name,
					formatToolVersion(version),
				]),
			),
		}))
		.sort((a, b) => a.path.localeCompare(b.path));

	return {
		projects: entries.sort((a, b) => a.rootDir.localeCompare(b.rootDir)),
		configFiles,
	};
}
