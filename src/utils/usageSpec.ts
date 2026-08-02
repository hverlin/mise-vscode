export interface UsageCompletionItem {
	name: string;
	detail: string;
	insertText: string;
	documentation?: string;
}

/**
 * Directives valid at the start of a usage spec line.
 * See https://usage.jdx.dev/spec/ and https://mise.jdx.dev/tasks/task-arguments.html
 */
export const usageDirectiveItems: UsageCompletionItem[] = [
	{
		name: "arg",
		detail:
			'Define a positional argument - arg "<name>" (required) or arg "[name]" (optional)',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
		insertText: 'arg "<${1:name}>" help="${2:Argument description}"',
		documentation: `Define a positional argument.

Use \`<name>\` for a required argument and \`[name]\` for an optional one.

Attributes: \`help\`, \`default\`, \`env\`, \`var=#true\` (variadic), \`hide=#true\`.
Restrict values with a \`choices\` block:

\`\`\`
arg "<environment>" help="Target environment" {
  choices "dev" "staging" "prod"
}
\`\`\`

The value is available in the run script as \`$usage_name\`.`,
	},
	{
		name: "flag",
		detail:
			'Define a flag - flag "-v --verbose"; add "<value>" for flags that take a value',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
		insertText: 'flag "--${1:name}" help="${2:Flag description}"',
		documentation: `Define a flag.

\`\`\`
flag "-v --verbose" help="Enable verbose output"
flag "--format <format>" help="Output format" default="text"
\`\`\`

Attributes: \`help\`, \`default\`, \`env\`, \`global=#true\`, \`count=#true\`, \`required=#true\`, \`var=#true\`, \`negate="--no-..."\`, \`hide=#true\`.

The value is available in the run script as \`$usage_name\`.`,
	},
	{
		name: "complete",
		detail:
			'Define custom completion for an arg/flag - complete "name" run="command"',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
		insertText: 'complete "${1:name}" run="${2:command}"',
		documentation: `Define custom completion for an argument or flag, referenced by name.

\`\`\`
arg "<plugin>"
complete "plugin" run="mise plugins ls"
\`\`\`

With \`descriptions=#true\` each output line is a \`value:description\` pair:

\`\`\`
complete "plugin" run="mycli plugins list" descriptions=#true
\`\`\``,
	},
];

/** Attributes valid on both `arg` and `flag` lines */
const sharedAttributeItems: UsageCompletionItem[] = [
	{
		name: "help",
		detail: "Help text shown in prompts and help output",
		insertText: 'help="$1"',
	},
	{
		name: "long_help",
		detail: "Extended help text shown in long help output",
		insertText: 'long_help="$1"',
	},
	{
		name: "default",
		detail: "Default value used when the arg/flag is not provided",
		insertText: 'default="$1"',
	},
	{
		name: "env",
		detail: "Environment variable that can back this arg/flag",
		insertText: 'env="$1"',
	},
	{
		name: "var",
		detail: "Allow multiple values - var=#true",
		insertText: "var=#true",
	},
	{
		name: "hide",
		detail: "Hide this arg/flag from help and completions - hide=#true",
		insertText: "hide=#true",
	},
];

export const argAttributeItems: UsageCompletionItem[] = sharedAttributeItems;

export const flagAttributeItems: UsageCompletionItem[] = [
	...sharedAttributeItems,
	{
		name: "required",
		detail: "Mark the flag as required - required=#true",
		insertText: "required=#true",
	},
	{
		name: "global",
		detail: "Make the flag available on all subcommands - global=#true",
		insertText: "global=#true",
	},
	{
		name: "count",
		detail:
			"Flag can be repeated, the value is the repetition count - count=#true",
		insertText: "count=#true",
	},
	{
		name: "negate",
		detail: 'Negated form of the flag - negate="--no-force"',
		insertText: 'negate="--no-$1"',
	},
];

export const completeAttributeItems: UsageCompletionItem[] = [
	{
		name: "run",
		detail:
			'Command whose output lines become the completions - run="mise plugins ls"',
		insertText: 'run="$1"',
	},
	{
		name: "descriptions",
		detail:
			"Treat each output line as a value:description pair - descriptions=#true",
		insertText: "descriptions=#true",
	},
];

const choicesItem: UsageCompletionItem = {
	name: "choices",
	detail: 'Restrict allowed values - choices "a" "b"',
	// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
	insertText: 'choices "${1:one}" "${2:two}"',
	documentation: `Restrict the allowed values of an arg/flag, inside its block:

\`\`\`
arg "<environment>" help="Target environment" {
  choices "dev" "staging" "prod"
}
\`\`\``,
};

const flagValueArgItem: UsageCompletionItem = {
	name: "arg",
	detail: 'Value argument of this flag - arg "<value>"',
	// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
	insertText: 'arg "<${1:value}>"',
};

/** Items valid inside an `arg "<name>" { ... }` block */
export const argBlockItems: UsageCompletionItem[] = [choicesItem];

/** Items valid inside a `flag "--name" { ... }` block */
export const flagBlockItems: UsageCompletionItem[] = [
	choicesItem,
	flagValueArgItem,
];

/**
 * Task configuration keys valid in `#MISE` comments of file tasks.
 * Each `#MISE` line is TOML.
 * See https://mise.jdx.dev/tasks/task-configuration.html
 * and https://mise.jdx.dev/tasks/file-tasks.html#task-configuration
 */
export const fileTaskConfigItems: UsageCompletionItem[] = [
	{
		name: "description",
		detail: "Description of the task",
		insertText: 'description="$1"',
	},
	{
		name: "alias",
		detail: "Alias for the task",
		insertText: 'alias="$1"',
	},
	{
		name: "depends",
		detail: "Tasks to run before this task",
		insertText: 'depends=["$1"]',
	},
	{
		name: "depends_post",
		detail: "Tasks to run after this task",
		insertText: 'depends_post=["$1"]',
	},
	{
		name: "wait_for",
		detail: "Wait for these tasks to complete if they are also running",
		insertText: 'wait_for=["$1"]',
	},
	{
		name: "env",
		detail: "Environment variables for the task",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
		insertText: 'env={${1:KEY} = "${2:value}"}',
	},
	{
		name: "tools",
		detail: "Tools to install and activate for this task",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
		insertText: 'tools={${1:node} = "${2:20}"}',
	},
	{
		name: "dir",
		detail: "Directory to run the task from",
		insertText: 'dir="$1"',
	},
	{
		name: "sources",
		detail: "Files this task uses as input (skip run if unchanged)",
		insertText: 'sources=["$1"]',
	},
	{
		name: "outputs",
		detail: "Files this task creates",
		insertText: 'outputs=["$1"]',
	},
	{
		name: "shell",
		detail: "Shell used to run the script",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
		insertText: 'shell="${1:bash -c}"',
	},
	{
		name: "confirm",
		detail: "Prompt for confirmation with this message before running",
		insertText: 'confirm="$1"',
	},
	{
		name: "hide",
		detail: "Hide the task from listings",
		insertText: "hide=true",
	},
	{
		name: "quiet",
		detail: "Suppress mise output for the task",
		insertText: "quiet=true",
	},
	{
		name: "silent",
		detail: "Suppress all output of the task",
		insertText: "silent=true",
	},
	{
		name: "raw",
		detail: "Connect the task directly to the terminal's stdin/stdout/stderr",
		insertText: "raw=true",
	},
];

export type UsageCursorContext =
	| { kind: "directive" }
	| {
			kind: "attribute";
			directive: "arg" | "flag" | "complete";
			used: string[];
	  }
	| { kind: "block"; directive: "arg" | "flag"; used: string[] }
	| { kind: "none" };

/**
 * Completion items appropriate for the given cursor context.
 * Attributes and block items that are already present (`used`) are not
 * offered again.
 */
export function getUsageCompletionItems(
	context: UsageCursorContext,
): UsageCompletionItem[] {
	switch (context.kind) {
		case "directive":
			return usageDirectiveItems;
		case "attribute": {
			const items =
				context.directive === "flag"
					? flagAttributeItems
					: context.directive === "complete"
						? completeAttributeItems
						: argAttributeItems;
			return items.filter((item) => !context.used.includes(item.name));
		}
		case "block": {
			const items =
				context.directive === "flag" ? flagBlockItems : argBlockItems;
			return items.filter((item) => !context.used.includes(item.name));
		}
		case "none":
			return [];
	}
}

/** Hover documentation for a usage spec keyword (directive or attribute) */
export function getUsageHoverInfo(word: string): string | undefined {
	const item = [
		...usageDirectiveItems,
		...flagAttributeItems,
		...completeAttributeItems,
		choicesItem,
	].find((candidate) => candidate.name === word);
	return item ? (item.documentation ?? item.detail) : undefined;
}

/** Hover documentation for a `#MISE` task configuration key */
export function getFileTaskConfigHoverInfo(word: string): string | undefined {
	return fileTaskConfigItems.find((item) => item.name === word)?.detail;
}

/** `{`/`}` balance of a line, ignoring braces inside double-quoted strings */
function braceDelta(line: string): number {
	let delta = 0;
	let inString = false;
	for (const char of line) {
		if (char === '"') {
			inString = !inString;
		} else if (!inString) {
			if (char === "{") {
				delta++;
			} else if (char === "}") {
				delta--;
			}
		}
	}
	return delta;
}

export function isInsideQuotedString(linePrefix: string): boolean {
	let inString = false;
	for (const char of linePrefix) {
		if (char === '"') {
			inString = !inString;
		}
	}
	return inString;
}

/** Attribute names already written on the line (e.g. `help=` -> "help") */
function usedAttributeNames(linePrefix: string): string[] {
	return [...linePrefix.matchAll(/(?:^|\s)([a-z_]+)=/g)].map(
		(match) => match[1] ?? "",
	);
}

/** First words of the lines inside a block (e.g. an already present `choices`) */
function usedBlockNames(blockLines: string[]): string[] {
	return blockLines
		.map((line) => line.trim().split(/\s+/)[0] ?? "")
		.filter((word) => /^[a-z_]+$/.test(word));
}

/**
 * What the cursor points at inside a usage spec:
 * - `directive` at the start of a line (offer `arg`/`flag`/`complete`)
 * - `attribute` after a directive and its name (offer `help=`, `default=`, ...)
 * - `block` inside an `arg`/`flag` `{ ... }` block (offer `choices`)
 * - `none` while typing a quoted string or in an unknown position
 *
 * `previousLines` are the usage spec lines above the cursor,
 * `linePrefix` is the current line up to the cursor
 * (both without the `#USAGE` prefix for file tasks).
 */
export function getUsageCursorContext(
	previousLines: string[],
	linePrefix: string,
): UsageCursorContext {
	if (isInsideQuotedString(linePrefix)) {
		return { kind: "none" };
	}

	// Innermost unclosed `arg`/`flag` block above the cursor, and its content
	let depth = 0;
	let blockDirective: "arg" | "flag" | undefined;
	let blockLines: string[] = [];
	for (const line of previousLines) {
		const delta = braceDelta(line);
		if (depth === 0 && delta > 0) {
			const firstWord = line.trim().split(/\s+/)[0];
			blockDirective =
				firstWord === "arg" || firstWord === "flag" ? firstWord : undefined;
			blockLines = [];
		} else if (depth > 0) {
			blockLines.push(line);
		}
		depth = Math.max(0, depth + delta);
		if (depth === 0) {
			blockDirective = undefined;
			blockLines = [];
		}
	}

	const trimmed = linePrefix.trim();
	const firstWord = trimmed.split(/\s+/)[0] ?? "";

	// An `arg "<name>" { ... }` block opened on the current line
	if (braceDelta(linePrefix) > 0) {
		if (firstWord === "arg" || firstWord === "flag") {
			const afterBrace = linePrefix.slice(linePrefix.lastIndexOf("{") + 1);
			return {
				kind: "block",
				directive: firstWord,
				used: usedBlockNames([afterBrace]),
			};
		}
		return { kind: "none" };
	}

	// Start of a line (or a partially typed word)
	if (/^[a-zA-Z_]*$/.test(trimmed)) {
		if (depth > 0) {
			return blockDirective
				? {
						kind: "block",
						directive: blockDirective,
						used: usedBlockNames(blockLines),
					}
				: { kind: "none" };
		}
		return { kind: "directive" };
	}

	// After a directive and its complete quoted name
	if (
		(firstWord === "arg" || firstWord === "flag" || firstWord === "complete") &&
		trimmed.includes('"')
	) {
		return {
			kind: "attribute",
			directive: firstWord,
			used: usedAttributeNames(linePrefix),
		};
	}

	return { kind: "none" };
}

/**
 * Line index of the `<key> = '''` opening the multiline string the position
 * is inside of, or null when the position is not inside one. Works on raw
 * lines so it can be used without a TOML parser (and unit tested without
 * vscode).
 */
function findKeyStringStart(
	lines: string[],
	position: { line: number; character: number },
	key: string,
): number | null {
	const currentLine = lines[position.line];
	if (currentLine === undefined) {
		return null;
	}

	const keyOpenRe = new RegExp(`^\\s*${key}\\s*=\\s*('''|""")`);

	// Opening `<key> = '''` on the current line: only inside after the quotes
	const openOnCurrent = currentLine.match(keyOpenRe);
	if (openOnCurrent) {
		const quoteEnd = openOnCurrent[0].length;
		const closed = currentLine.slice(quoteEnd).includes(openOnCurrent[1] ?? "");
		return !closed && position.character >= quoteEnd ? position.line : null;
	}

	for (let lineNum = position.line - 1; lineNum >= 0; lineNum--) {
		const line = lines[lineNum];
		if (line === undefined) {
			continue;
		}
		const keyOpen = line.match(keyOpenRe);
		if (keyOpen) {
			// If the string is closed on the same line, we are not inside it
			const rest = line.slice(keyOpen[0].length);
			return rest.includes(keyOpen[1] ?? "") ? null : lineNum;
		}
		if (/('''|""")/.test(line)) {
			// Boundary of some other multiline string (including the closing
			// quotes of the searched block above the cursor)
			return null;
		}
		if (/^\s*\[/.test(line)) {
			// A table header means we are not inside any multiline string
			return null;
		}
	}

	return null;
}

/**
 * Line index of the `usage = '''` opening the multiline usage string the
 * position is inside of, or null when the position is not inside one.
 */
export function findUsageStringStart(
	lines: string[],
	position: { line: number; character: number },
): number | null {
	return findKeyStringStart(lines, position, "usage");
}

/**
 * Variable names (without the `usage_` prefix) defined by the args and flags
 * of a usage spec. Dashes are converted to underscores like mise does for
 * the `usage_*` environment variables.
 */
export function getUsageVariableNames(specLines: string[]): string[] {
	const names: string[] = [];
	for (const line of specLines) {
		const trimmed = line.trim();
		const argMatch = trimmed.match(/^arg\s+"[<[]([^>\]]+)[>\]]"/);
		if (argMatch?.[1]) {
			names.push(argMatch[1]);
			continue;
		}
		const flagMatch = trimmed.match(/^flag\s+"([^"]+)"/);
		if (flagMatch?.[1]) {
			const long = flagMatch[1].match(/--([A-Za-z0-9][\w-]*)/);
			const short = flagMatch[1].match(/(?:^|\s)-([A-Za-z0-9])(?:\s|$)/);
			const name = long?.[1] ?? short?.[1];
			if (name) {
				names.push(name);
			}
		}
	}
	return [...new Set(names)].map((name) => name.replace(/-/g, "_"));
}

/**
 * When the position is inside a task's `run = '''...'''` string, returns the
 * lines of the `usage = '''...'''` field of the same task (searching the
 * whole `[tasks.<name>]` section), or null otherwise.
 */
export function getEnclosingTaskUsageLines(
	lines: string[],
	position: { line: number; character: number },
): string[] | null {
	const runStart = findKeyStringStart(lines, position, "run");
	if (runStart === null) {
		return null;
	}

	// Bounds of the enclosing [tasks.<name>] section
	let sectionStart = 0;
	for (let lineNum = runStart - 1; lineNum >= 0; lineNum--) {
		if (/^\s*\[/.test(lines[lineNum] ?? "")) {
			sectionStart = lineNum + 1;
			break;
		}
	}

	const specLines: string[] = [];
	let stringDelimiter: string | null = null;
	let collecting = false;
	for (let lineNum = sectionStart; lineNum < lines.length; lineNum++) {
		const line = lines[lineNum] ?? "";

		if (stringDelimiter) {
			if (line.includes(stringDelimiter)) {
				stringDelimiter = null;
				collecting = false;
			} else if (collecting) {
				specLines.push(line);
			}
			continue;
		}

		if (/^\s*\[/.test(line)) {
			break; // next section
		}

		const multiline = line.match(/^\s*([A-Za-z_][\w-]*)\s*=\s*('''|""")(.*)$/);
		if (multiline) {
			const [, key, delimiter = "", rest = ""] = multiline;
			if (rest.includes(delimiter)) {
				if (key === "usage") {
					specLines.push(rest.slice(0, rest.indexOf(delimiter)));
				}
			} else {
				stringDelimiter = delimiter;
				collecting = key === "usage";
			}
			continue;
		}

		const singleLine = line.match(/^\s*usage\s*=\s*(["'])(.*)\1\s*$/);
		if (singleLine?.[2]) {
			specLines.push(singleLine[2]);
		}
	}

	return specLines.length > 0 ? specLines : null;
}

/**
 * Whether the given position is inside a multiline `usage = '''...'''`
 * (or `usage = """..."""`) string.
 */
export function isInsideUsageString(
	lines: string[],
	position: { line: number; character: number },
): boolean {
	return findUsageStringStart(lines, position) !== null;
}
