import { expandPath } from "./fileUtils";
import { escapeMarkdown, markdownCodeSpan } from "./markdown";
import { toWebUrl } from "./miseUtilts";

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

const formatVersions = (versions: string[]) =>
	versions.map(escapeMarkdown).join(", ");

/** installed versions listed, the newest ones */
const MAX_INSTALLED_VERSIONS = 5;

function formatInstalledVersions(versions: string[]): string {
	const newestFirst = [...versions].reverse();
	const listed = formatVersions(newestFirst.slice(0, MAX_INSTALLED_VERSIONS));
	const more = newestFirst.length - MAX_INSTALLED_VERSIONS;
	return more > 0 ? `${listed} and ${more} more` : listed;
}

/**
 * The hover of a tool in a config: its name and backend, its description,
 * then one line per detail.
 */
export function formatToolHover({
	toolName,
	toolInfo,
	requestedVersion,
	backendWebsite,
	update,
}: {
	toolName: string;
	toolInfo: MiseToolInfo;
	/** the version requested where the tool is hovered */
	requestedVersion?: string;
	/** where the backend gets the tool from, e.g. its repository */
	backendWebsite?: string;
	update?: MiseToolUpdate;
}): string {
	const backend = backendWebsite
		? markdownLink(toolInfo.backend, backendWebsite)
		: escapeMarkdown(toolInfo.backend);
	const title =
		toolName === toolInfo.backend
			? `**${backend}**`
			: `**${escapeMarkdown(toolName)}** · ${backend}`;

	const active = toolInfo.active_versions ?? [];
	const requested = requestedVersion
		? escapeMarkdown(requestedVersion)
		: formatVersions(toolInfo.requested_versions ?? []);
	const version = active.length
		? formatVersions(active)
		: toolInfo.tool_options?.lazy
			? "installs on first use"
			: "not installed";
	const otherInstalled = (toolInfo.installed_versions ?? []).some(
		(installed) => !active.includes(installed),
	);
	// the project, when the registry knows it, besides where the tool comes from
	const website = toWebUrl(toolInfo.url ?? undefined);
	const options = formatToolOptions(toolInfo.tool_options);

	const details = [
		`**Version** ${version}${
			requested && requested !== version ? ` · requested ${requested}` : ""
		}`,
		update?.latest &&
			`**Update** ${escapeMarkdown(update.latest)}${
				update.release_url
					? ` · ${markdownLink("release notes", update.release_url)}`
					: ""
			}`,
		otherInstalled &&
			`**Installed** ${formatInstalledVersions(toolInfo.installed_versions)}`,
		website &&
			website !== backendWebsite &&
			`**Website** ${markdownLink(getWebsiteLabel(website), website)}`,
		options && `**Options** ${options}`,
	].filter(Boolean);

	return [
		title,
		toolInfo.description && escapeMarkdown(toolInfo.description),
		// a line break, without the space between paragraphs
		details.join("  \n"),
	]
		.filter(Boolean)
		.join("\n\n");
}
