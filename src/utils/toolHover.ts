import { expandPath } from "./fileUtils";
import { escapeMarkdown, markdownCodeSpan } from "./markdown";

/**
 * A markdown link. The destination is in angle brackets, which a `)` in the
 * URL (e.g. in a tag name) does not end; `URL` encodes the brackets in it.
 */
export function markdownLink(text: string, url: string): string {
	return `[${escapeMarkdown(text)}](<${url}>)`;
}

/** `dart.dev` for `https://dart.dev/` */
export function getWebsiteLabel(url: string): string {
	return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * The newer version of a tool declared in `configPath`. `mise outdated` has
 * one entry per tool, for the config that wins, and also lists the tools that
 * are not installed, with the requested version as the latest one.
 */
export function findToolUpdate(
	outdatedTools: MiseToolUpdate[],
	toolName: string,
	configPath: string,
): MiseToolUpdate | undefined {
	const update = outdatedTools.find((tool) => tool.name === toolName);
	if (
		!update?.version ||
		!update.latest ||
		update.latest === update.version ||
		!update.source?.path ||
		expandPath(update.source.path) !== expandPath(configPath)
	) {
		return undefined;
	}
	return update;
}

/** a key of a TOML table, quoted unless it is a bare key */
function toTomlKey(key: string): string {
	return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

/** a value as written in a TOML file, tables inline */
function toTomlValue(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(toTomlValue).join(", ")}]`;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value).map(
			([key, entry]) => `${toTomlKey(key)} = ${toTomlValue(entry)}`,
		);
		return entries.length ? `{ ${entries.join(", ")} }` : "{}";
	}
	return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** mise lists every tool option, null or empty when it is not set */
function isSetOption(value: unknown): boolean {
	if (value === null || value === undefined || value === "") {
		return false;
	}
	if (Array.isArray(value)) {
		return value.length > 0;
	}
	if (typeof value === "object") {
		return Object.keys(value).length > 0;
	}
	return true;
}

/**
 * The options set on a tool, as written in its config, e.g. `lazy = true`.
 * Undefined when none is.
 */
export function formatToolOptions(
	options: Record<string, unknown> | undefined,
): string | undefined {
	const setOptions = Object.entries(options ?? {}).filter(([, value]) =>
		isSetOption(value),
	);
	if (!setOptions.length) {
		return undefined;
	}
	return setOptions
		.map(([key, value]) =>
			markdownCodeSpan(`${toTomlKey(key)} = ${toTomlValue(value)}`),
		)
		.join(", ");
}
