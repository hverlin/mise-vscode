// CommonMark treats a backslash before any of these as a literal character
const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;

/**
 * Escape a value interpolated into a `MarkdownString`. Tooltips built with
 * `isTrusted` render `command:` links, so a value holding `](command:…)` would
 * otherwise become a clickable command with attacker-chosen arguments. Line
 * breaks are collapsed as well, they would start a new markdown block.
 */
export function escapeMarkdown(value: string): string {
	return value.replace(/\s*[\r\n]+\s*/g, " ").replace(ESCAPABLE, "\\$&");
}

/**
 * Render a value as inline code. Backslash escapes are literal inside a code
 * span, so {@link escapeMarkdown} must not be used here; the value is fenced
 * with more backticks than it contains instead, which is what keeps it from
 * closing the span early. No markdown is interpreted within, links included.
 */
export function markdownCodeSpan(value: string): string {
	const text = value.replace(/\s*[\r\n]+\s*/g, " ");

	const longestRun = Math.max(
		0,
		...[...text.matchAll(/`+/g)].map((match) => match[0].length),
	);
	const fence = "`".repeat(longestRun + 1);

	// a backtick touching the fence would be read as part of it, and the
	// renderer drops one padding space on each side
	const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";

	return `${fence}${pad}${text}${pad}${fence}`;
}
