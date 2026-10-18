import { expandPath } from "./fileUtils";
import { escapeMarkdown } from "./markdown";

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
