import type * as vscode from "vscode";

function extractTomlKey(token: string): string {
	const t = token.trim();
	if (
		(t.startsWith('"') && t.endsWith('"')) ||
		(t.startsWith("'") && t.endsWith("'"))
	) {
		return t.slice(1, -1);
	}
	return t;
}

/**
 * Splits a (possibly dotted) TOML key into its first segment and the rest.
 * Quoted segments may contain dots (e.g. `"http:my.tool".platforms`).
 *
 * - `node` → { first: "node", rest: "" }
 * - `node.version` → { first: "node", rest: ".version" }
 * - `"npm:tool"` → { first: "npm:tool", rest: "" }
 * - `"http:my-tool".platforms` → { first: "http:my-tool", rest: ".platforms" }
 */
function splitFirstKeySegment(raw: string): { first: string; rest: string } {
	const t = raw.trim();
	const quote = t[0];

	if (quote === '"' || quote === "'") {
		const end = t.indexOf(quote, 1);
		if (end !== -1) {
			return { first: t.slice(1, end), rest: t.slice(end + 1).trim() };
		}
	}

	const dotIndex = t.indexOf(".");
	if (dotIndex === -1) {
		return { first: extractTomlKey(t), rest: "" };
	}

	return { first: t.slice(0, dotIndex).trim(), rest: t.slice(dotIndex).trim() };
}

/**
 * Splits a dotted tool key into the tool name and the option path.
 *
 * - `node` → { toolName: "node", optionPath: "" }
 * - `node.version` → { toolName: "node", optionPath: "version" }
 * - `"ubi:sharkdp/fd".version` → { toolName: "ubi:sharkdp/fd", optionPath: "version" }
 */
export function splitDottedToolKey(raw: string): {
	toolName: string;
	optionPath: string;
} {
	const { first, rest } = splitFirstKeySegment(raw);
	return { toolName: first, optionPath: rest.replace(/^\./, "") };
}

/**
 * Parses a `[tools.<name>]` section header line.
 *
 * - `[tools.node]` → { toolName: "node", isSubTable: false }
 * - `[tools."npm:prettier"]` → { toolName: "npm:prettier", isSubTable: false }
 * - `[tools."http:my-tool".platforms]` → { toolName: "http:my-tool", isSubTable: true }
 * - `[tools]`, `[tasks.build]` → undefined
 */
export function parseToolsSectionHeader(
	lineText: string,
): { toolName: string; isSubTable: boolean } | undefined {
	const match = lineText.trim().match(/^\[\s*tools\s*\.\s*(.+?)\s*\]/);
	if (!match?.[1]) {
		return undefined;
	}

	const { first, rest } = splitFirstKeySegment(match[1]);
	if (!first) {
		return undefined;
	}

	return { toolName: first, isSubTable: rest.startsWith(".") };
}

/**
 * Checks if the given position in a TOML document is within a tools definition context.
 * This includes:
 * 1. Inside a `[tools]` block
 * 2. Inside a `[tools.toolName]` section (including its header line)
 * 3. Inside a `tools = { ... }` declaration within a `[tasks.*]` block
 * 4. Inside a `tools.toolName = ...` or `tools."tool:name" = ...` line
 *
 * `inToolOptionsSection` is true for lines inside the body of a `[tools.toolName]`
 * section — those lines hold tool options (`version`, `os`, `postinstall`, ...),
 * not tool declarations. The header line itself is not part of the options body.
 */
export function isPositionInToolsContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): {
	inContext: boolean;
	isInline: boolean;
	inToolOptionsSection: boolean;
	sectionToolName?: string;
} {
	const lineText = document.lineAt(position.line).text;

	// Match `tools = { ... }` inline table
	if (lineText.match(/^\s*tools\s*=\s*\{/)) {
		return { inContext: true, isInline: true, inToolOptionsSection: false };
	}

	// Match `tools.key = ...` or `tools."key" = ...` or `tools.'key' = ...`
	if (lineText.match(/^\s*tools\s*\.\s*(?:["'][^"']+["']|[^\s=]+)\s*=/)) {
		return { inContext: true, isInline: true, inToolOptionsSection: false };
	}

	// Otherwise, fallback to checking if we are under a `[tools]` block or subtable
	for (let i = position.line; i >= 0; i--) {
		const line = document.lineAt(i).text.trim();
		const headerMatch = line.match(/^\[([^\]]+)\]/);
		if (!headerMatch) {
			continue;
		}
		const sectionName = headerMatch[1]?.trim();
		if (sectionName === "tools") {
			return { inContext: true, isInline: false, inToolOptionsSection: false };
		}

		const toolsHeader = parseToolsSectionHeader(line);
		if (toolsHeader) {
			return {
				inContext: true,
				isInline: false,
				// The header line declares the tool; lines below it are options
				inToolOptionsSection: i !== position.line,
				sectionToolName: toolsHeader.toolName,
			};
		}
		break;
	}

	return { inContext: false, isInline: false, inToolOptionsSection: false };
}

/**
 * Checks if the given position in a TOML document is within a task definition
 * context. This includes:
 * 1. Inside a `[tasks]` block
 * 2. Inside a `[tasks.taskName]` section (including its header line)
 * 3. Inside a `tasks.taskName = { ... }` line
 *
 * `[task_templates.*]` sections are not task definitions: templates are
 * resolved for tasks only.
 */
export function isPositionInTasksContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): boolean {
	const lineText = document.lineAt(position.line).text;
	if (/^\s*tasks\s*\.\s*(?:["'][^"']+["']|[^\s=]+)\s*=/.test(lineText)) {
		return true;
	}

	for (let i = position.line; i >= 0; i--) {
		const sectionName = document
			.lineAt(i)
			.text.trim()
			.match(/^\[([^\]]+)\]/)?.[1]
			?.trim();
		if (sectionName === undefined) {
			continue;
		}
		return sectionName === "tasks" || /^tasks\s*\./.test(sectionName);
	}

	return false;
}

/** Task fields whose entries are task names (`depends = ["build"]`) */
const TASK_DEPENDS_FIELDS = new Set(["depends", "depends_post", "wait_for"]);
/** Task fields whose entries are shell commands, task names only in tables */
const TASK_RUN_FIELDS = new Set(["run", "run_windows"]);

/** `key =`, `a.b =`, `tasks."test:e2e".daemons =` */
const TOML_ASSIGNMENT =
	/^\s*((?:[\w-]+|"[^"]*"|'[^']*')(?:\s*\.\s*(?:[\w-]+|"[^"]*"|'[^']*'))*)\s*=/;
/** a header holds a single (dotted) key, unlike an array element line */
const TOML_SECTION_HEADER = /^\s*\[\[?[^,=[\]]*\]\]?\s*(?:#.*)?$/;

/** The segments of a dotted key, `tasks."docs:build".depends` included */
function splitDottedKey(raw: string): string[] {
	const segments: string[] = [];
	let rest = raw.trim();
	while (rest) {
		const { first, rest: remaining } = splitFirstKeySegment(rest);
		segments.push(first);
		rest = remaining.replace(/^\./, "").trim();
	}
	return segments;
}

/**
 * The key path of the table a line is in, from the closest header above it.
 * A line that only looks like a header, in a multiline string or a multiline
 * array (`run = """` ... `[server]`, or `["lint"]` in a `depends` array), is
 * not one.
 */
function enclosingTablePath(
	document: vscode.TextDocument,
	line: number,
): string[] {
	let table: string[] = [];
	/** the delimiter of the multiline string the scan is in */
	let multiline: string | undefined;
	/** open arrays and inline tables */
	let depth = 0;

	for (let i = 0; i < line; i++) {
		const text = document.lineAt(i).text;
		if (!multiline && depth === 0 && TOML_SECTION_HEADER.test(text)) {
			table = splitDottedKey(
				text
					.trim()
					.replace(/^\[\[?/, "")
					.replace(/\]\]?\s*(?:#.*)?$/, ""),
			);
			continue;
		}
		for (let j = 0; j < text.length; j++) {
			if (multiline) {
				if (multiline === '"""' && text[j] === "\\") {
					j++;
				} else if (text.startsWith(multiline, j)) {
					multiline = undefined;
					j += 2;
				}
				continue;
			}
			const char = text[j];
			if (text.startsWith('"""', j) || text.startsWith("'''", j)) {
				multiline = text.slice(j, j + 3);
				j += 2;
			} else if (char === '"' || char === "'") {
				// a string of one line
				for (j++; j < text.length && text[j] !== char; j++) {
					if (char === '"' && text[j] === "\\") {
						j++;
					}
				}
			} else if (char === "#") {
				break;
			} else if (char === "[" || char === "{") {
				depth++;
			} else if (char === "]" || char === "}") {
				depth = Math.max(0, depth - 1);
			}
		}
	}
	return table;
}

/** An open `[` array or `{` inline table around the cursor */
type TomlFrame =
	| { kind: "array"; index: number }
	| { kind: "table"; key: string | undefined };

/** The assignment the cursor sits in the value of, looking at earlier lines */
function findEnclosingAssignment(
	document: vscode.TextDocument,
	position: vscode.Position,
):
	| { field: string; keys: string[]; line: number; valueStart: number }
	| undefined {
	for (let i = position.line; i >= 0; i--) {
		const text =
			i === position.line
				? document.lineAt(i).text.slice(0, position.character)
				: document.lineAt(i).text;

		const match = text.match(TOML_ASSIGNMENT);
		if (match?.[1]) {
			// `tasks.build.depends = [` is the same field as `depends = [`
			const keys = splitDottedKey(match[1]);
			return {
				field: keys[keys.length - 1] ?? "",
				keys,
				line: i,
				valueStart: match[0].length,
			};
		}
		if (TOML_SECTION_HEADER.test(text)) {
			return undefined;
		}
	}
	return undefined;
}

/**
 * Walks the value of `assignment` up to the cursor, returning the containers
 * still open there and whether the cursor is inside a string literal.
 * `undefined` when the value ended before the cursor.
 */
function scanTomlValue(
	document: vscode.TextDocument,
	position: vscode.Position,
	assignment: { line: number; valueStart: number },
): { frames: TomlFrame[]; inQuote: boolean } | undefined {
	const parts: string[] = [];
	for (let i = assignment.line; i <= position.line; i++) {
		const text =
			i === position.line
				? document.lineAt(i).text.slice(0, position.character)
				: document.lineAt(i).text;
		parts.push(
			i === assignment.line ? text.slice(assignment.valueStart) : text,
		);
	}
	const region = parts.join("\n");

	const frames: TomlFrame[] = [];
	let quote: string | undefined;
	// characters since the last separator, i.e. the key of a pending assignment
	let token = "";

	for (let i = 0; i < region.length; i++) {
		const char = region[i] ?? "";
		if (quote) {
			// a literal string ends at the end of the line, whatever it contains
			if (char === "\\" && quote === '"') {
				i++;
			} else if (char === quote || char === "\n") {
				quote = undefined;
			}
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			token = "";
		} else if (char === "#") {
			while (i < region.length && region[i] !== "\n") {
				i++;
			}
			token = "";
		} else if (char === "[") {
			frames.push({ kind: "array", index: 0 });
			token = "";
		} else if (char === "{") {
			frames.push({ kind: "table", key: undefined });
			token = "";
		} else if (char === "]" || char === "}") {
			frames.pop();
			token = "";
			if (!frames.length) {
				return undefined;
			}
		} else if (char === ",") {
			const frame = frames[frames.length - 1];
			if (frame?.kind === "array") {
				frame.index++;
			} else if (frame?.kind === "table") {
				frame.key = undefined;
			}
			token = "";
		} else if (char === "=") {
			const frame = frames[frames.length - 1];
			if (frame?.kind === "table") {
				frame.key = extractTomlKey(token);
			}
			token = "";
		} else {
			token += char;
		}
	}

	// a scalar value that is already written, e.g. `depends = "build"|`
	if (!frames.length && !quote && region.trim()) {
		return undefined;
	}

	return { frames, inQuote: Boolean(quote) };
}

/**
 * Checks whether the position is on a value naming a task, in any of the forms
 * mise accepts (https://mise.jdx.dev/tasks/task-configuration.html):
 *
 * - `depends`, `depends_post` and `wait_for` entries, as a bare string, an
 *   array entry, the first element of a `["task", "--arg"]` entry, or the
 *   `task` key of a `{ task = "build", args = [...] }` entry
 * - `run` and `run_windows` entries that reference tasks: `{ task = "..." }`
 *   and `{ tasks = ["...", "..."] }`. Plain strings there are shell commands,
 *   and `args`/`env` values are not task names.
 *
 * Multiline arrays are supported. `inQuote` tells whether the cursor sits
 * inside a string literal, i.e. whether the name still needs its own quotes.
 */
export function getTaskNameValueContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): { inQuote: boolean } | undefined {
	const assignment = findEnclosingAssignment(document, position);
	if (!assignment) {
		return undefined;
	}

	const scanned = scanTomlValue(document, position, assignment);
	if (!scanned) {
		return undefined;
	}

	const { frames, inQuote } = scanned;

	// in a daemon, only `task` names a task: `depends` names daemons, see
	// getDaemonNameValueContext
	const table = [
		...enclosingTablePath(document, assignment.line),
		...assignment.keys,
	];
	if (table[0] === "daemons" || table[0] === "daemon_groups") {
		const path = [
			...table,
			...frames.flatMap((entry) =>
				entry.kind === "table" && entry.key ? [entry.key] : [],
			),
		];
		const isTaskOfDaemon =
			path.length === 3 &&
			path[0] === "daemons" &&
			path[2] === "task" &&
			!frames.some((entry) => entry.kind === "array");
		return isTaskOfDaemon ? { inQuote } : undefined;
	}

	const frame = frames[frames.length - 1];
	const parent = frames[frames.length - 2];

	// the key path of the cursor, arrays being transparent: `run = [{ task =`
	// gives ["run", "task"], and `tasks.a = { run = [{ task =` ["a", "run",
	// "task"]
	const path = [
		assignment.field,
		...frames
			.filter((entry) => entry.kind === "table")
			.map((entry) => entry.key),
	];
	const key = path[path.length - 1];
	const owner = path[path.length - 2];

	// `{ |` and `{ opt|` are key positions, not values
	if (frame?.kind === "table" && !frame.key) {
		return undefined;
	}

	if (
		key === "task" &&
		frame?.kind === "table" &&
		isTaskReferenceField(owner)
	) {
		return { inQuote };
	}
	if (
		key === "tasks" &&
		frame?.kind === "array" &&
		owner !== undefined &&
		TASK_RUN_FIELDS.has(owner)
	) {
		return { inQuote };
	}
	if (key !== undefined && TASK_DEPENDS_FIELDS.has(key)) {
		// `depends = [["build", "--arg"]]`: only the first element is a task
		if (
			frame?.kind === "array" &&
			parent?.kind === "array" &&
			frame.index > 0
		) {
			return undefined;
		}
		return { inQuote };
	}

	return undefined;
}

/** A key path in the `[daemons]` or `[daemon_groups]` of a config */
export const isDaemonsKeyPath = (keyPath: readonly unknown[]) =>
	keyPath[0] === "daemons" || keyPath[0] === "daemon_groups";

/** `[daemons.<name>] task = "..."`: the task a daemon runs */
export const isTaskOfDaemonKeyPath = (keyPath: readonly unknown[]) =>
	keyPath.length === 3 && keyPath[0] === "daemons" && keyPath[2] === "task";

/** What a value naming daemons accepts */
export type DaemonNameContext = {
	inQuote: boolean;
	accepts: "daemons" | "groups" | "daemonsAndGroups" | "presets";
	/** the daemon or group the value belongs to, which does not name itself */
	owner?: string;
	/** the config it means something in: a mise config, a pitchfork one, or both */
	syntax: "mise" | "pitchfork" | "any";
};

/**
 * Checks whether the position is on a value naming daemons
 * (https://mise.jdx.dev/daemons.html), in a mise or a pitchfork config:
 *
 * - the `daemons` of a mise task (or task template): daemons, or groups
 * - the `depends` of a daemon: other daemons
 * - the members of a mise `[daemon_groups]` group, in its array or table form:
 *   daemons, or other groups
 * - the `daemons` and `groups` of a pitchfork `[groups.<name>]` group
 * - the `preset` of a mise daemon: a service preset
 *
 * As a string, or an entry of a flat array where only an array is accepted.
 */
export function getDaemonNameValueContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): DaemonNameContext | undefined {
	const assignment = findEnclosingAssignment(document, position);
	if (!assignment) {
		return undefined;
	}
	const scanned = scanTomlValue(document, position, assignment);
	if (!scanned) {
		return undefined;
	}

	const { frames, inQuote } = scanned;
	const frame = frames[frames.length - 1];
	// `{ |` is a key position
	if (frame?.kind === "table" && !frame.key) {
		return undefined;
	}
	// only one level of array, holding the names
	const arrays = frames.filter((entry) => entry.kind === "array");
	if (arrays.length > 1 || (arrays.length === 1 && frame?.kind !== "array")) {
		return undefined;
	}
	const inArray = arrays.length === 1;

	const path = [
		...enclosingTablePath(document, assignment.line),
		...assignment.keys,
		...frames.flatMap((entry) =>
			entry.kind === "table" && entry.key ? [entry.key] : [],
		),
	];
	const [section, owner, field, ...rest] = path;
	if (rest.length || !owner) {
		return undefined;
	}

	if (
		(section === "tasks" || section === "task_templates") &&
		field === "daemons"
	) {
		return { inQuote, accepts: "daemonsAndGroups", syntax: "mise" };
	}
	if (section === "daemons") {
		// pitchfork reads a list only
		if (field === "depends" && inArray) {
			return { inQuote, accepts: "daemons", owner, syntax: "any" };
		}
		if (field === "preset" && !inArray) {
			return { inQuote, accepts: "presets", syntax: "mise" };
		}
		return undefined;
	}
	if (
		section === "daemon_groups" &&
		(field === undefined || field === "daemons") &&
		inArray
	) {
		return { inQuote, accepts: "daemonsAndGroups", owner, syntax: "mise" };
	}
	if (section === "groups" && inArray) {
		if (field === "daemons") {
			return { inQuote, accepts: "daemons", syntax: "pitchfork" };
		}
		if (field === "groups") {
			return { inQuote, accepts: "groups", owner, syntax: "pitchfork" };
		}
	}
	return undefined;
}

/**
 * The daemon name under the cursor, with the context it is in (see
 * {@link getDaemonNameValueContext}): a string of a value naming daemons.
 */
export function getDaemonNameAt(
	document: vscode.TextDocument,
	position: vscode.Position,
):
	| { name: string; start: number; end: number; context: DaemonNameContext }
	| undefined {
	const line = document.lineAt(position.line).text;
	for (const match of line.matchAll(/"([^"\\]*)"|'([^']*)'/g)) {
		const start = (match.index ?? 0) + 1;
		const name = match[1] ?? match[2] ?? "";
		const end = start + name.length;
		if (position.character < start || position.character > end || !name) {
			continue;
		}
		// the text before is all the context needs
		const context = getDaemonNameValueContext(document, {
			line: position.line,
			character: start,
		} as vscode.Position);
		return context ? { name, start, end, context } : undefined;
	}
	return undefined;
}

function isTaskReferenceField(field: string | undefined): boolean {
	return (
		field !== undefined &&
		(TASK_DEPENDS_FIELDS.has(field) || TASK_RUN_FIELDS.has(field))
	);
}

/**
 * Parses the text before the cursor when completing the value of an `extends`
 * key, which names a task template:
 *
 * - `extends = "py` → { quote: '"', partial: "py" }
 * - `extends = ` → { quote: "", partial: "" }
 * - `info = { extends = '` → { quote: "'", partial: "" }
 *
 * Returns undefined when the cursor is not on an `extends` value.
 */
export function parseExtendsValuePrefix(
	linePrefix: string,
): { quote: string; partial: string } | undefined {
	const match = linePrefix.match(/(?:^|[\s{,])extends\s*=\s*(["']?)([^"']*)$/);
	if (!match) {
		return undefined;
	}
	return { quote: match[1] ?? "", partial: match[2] ?? "" };
}

const CONFIG_ROOTS_ASSIGNMENT = /^\s*(monorepo\s*\.\s*)?config_roots\s*=\s*\[/;

/**
 * Checks if the given position is inside the value of a
 * `[monorepo] config_roots = [...]` array (or a top-level
 * `monorepo.config_roots = [...]` dotted assignment), including multiline
 * arrays.
 *
 * When in context, `inQuote` tells whether the cursor is inside an open
 * string literal and `partial` holds the path typed so far — the content of
 * the open string, or the bare (not yet quoted) token before the cursor.
 */
export function getConfigRootsArrayContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): { inQuote: boolean; partial: string } | undefined {
	let openLine = -1;
	let openChar = 0;
	let hasMonorepoPrefix = false;

	for (let i = position.line; i >= 0; i--) {
		const lineText =
			i === position.line
				? document.lineAt(i).text.slice(0, position.character)
				: document.lineAt(i).text;

		const match = lineText.match(CONFIG_ROOTS_ASSIGNMENT);
		if (match) {
			openLine = i;
			openChar = match[0].length;
			hasMonorepoPrefix = Boolean(match[1]);
			break;
		}

		const trimmed = lineText.trim();
		// a section header or another assignment means the cursor is not
		// inside a config_roots array value
		if (/^\[/.test(trimmed) || /^[\w."'-]+\s*=/.test(trimmed)) {
			return undefined;
		}
	}
	if (openLine === -1) {
		return undefined;
	}

	if (!hasMonorepoPrefix && !isInMonorepoSection(document, openLine - 1)) {
		return undefined;
	}

	// text from just after the opening `[` to the cursor
	const parts: string[] = [];
	for (let i = openLine; i <= position.line; i++) {
		let text = document.lineAt(i).text;
		if (i === position.line) {
			text = text.slice(0, position.character);
		}
		parts.push(i === openLine ? text.slice(openChar) : text);
	}
	const region = parts.join("\n");

	let depth = 1;
	let stringQuote: string | undefined;
	let stringStart = 0;
	let bareStart = 0;
	for (let idx = 0; idx < region.length; idx++) {
		const ch = region[idx] ?? "";
		if (stringQuote) {
			if (ch === stringQuote || ch === "\n") {
				stringQuote = undefined;
				bareStart = idx + 1;
			}
		} else if (ch === '"' || ch === "'") {
			stringQuote = ch;
			stringStart = idx + 1;
		} else if (ch === "[") {
			depth++;
		} else if (ch === "]") {
			depth--;
			if (depth === 0) {
				return undefined;
			}
		} else if (ch === "#") {
			while (idx < region.length && region[idx] !== "\n") {
				idx++;
			}
			bareStart = idx + 1;
		} else if (/[\s,]/.test(ch)) {
			bareStart = idx + 1;
		}
	}

	return stringQuote
		? { inQuote: true, partial: region.slice(stringStart) }
		: { inQuote: false, partial: region.slice(bareStart) };
}

function isInMonorepoSection(
	document: vscode.TextDocument,
	fromLine: number,
): boolean {
	for (let i = fromLine; i >= 0; i--) {
		const headerMatch = document
			.lineAt(i)
			.text.trim()
			.match(/^\[([^\]]+)\]/);
		if (headerMatch) {
			return headerMatch[1]?.trim() === "monorepo";
		}
	}
	return false;
}

/**
 * Parses the text before the cursor when completing the `version` value inside
 * an inline options table:
 *
 * - `node = { version = "2` → { toolName: "node", quote: '"', partial: "2" }
 * - `node = { version = ` → { toolName: "node", quote: "", partial: "" }
 * - `python = { version = ["3.` → { toolName: "python", quote: '"', partial: "3." }
 *
 * Returns undefined when the cursor is not on a version value (e.g. typing an
 * `os` or `postinstall` option).
 */
export function parseInlineTableVersionPrefix(
	linePrefix: string,
): { toolName: string; quote: string; partial: string } | undefined {
	const match = linePrefix.match(
		/^\s*((?:["'][^"']+["'])|(?:[^\s={]+))\s*=\s*\{.*\bversion\s*=\s*\[?\s*(["']?)([^"'{}[\]]*)$/,
	);
	if (!match?.[1]) {
		return undefined;
	}
	return {
		toolName: splitDottedToolKey(match[1]).toolName,
		quote: match[2] ?? "",
		partial: match[3] ?? "",
	};
}
