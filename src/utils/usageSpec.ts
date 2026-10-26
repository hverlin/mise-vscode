export interface UsageCompletionItem {
	name: string;
	detail: string;
	insertText: string;
	documentation?: string;
	/** open the suggestions again once inserted, for keys whose value completes */
	triggerSuggest?: boolean;
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

/** A `#MISE` task configuration line of a file task (also matches `# [MISE]`) */
export const MISE_COMMENT_RE = /^\s*#\s*(?:MISE|\[MISE\])\s/;

/**
 * The template named by a `#MISE extends="<name>"` line of a file task. Only
 * the header form mise applies: `#` at the start of the line, a space after
 * `MISE`.
 */
export function parseFileTaskExtends(line: string): string | undefined {
	const match = line.match(
		/^#\s*(?:MISE|\[MISE\]) +extends\s*=\s*(?:"([^"]+)"|'([^']+)')/,
	);
	return match?.[1] ?? match?.[2];
}

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
		name: "extends",
		detail:
			"Task template to inherit tools, env, description and other fields from",
		insertText: 'extends="$1"',
		documentation: `Task template to inherit tools, env, description and other fields from.

The fields of the task win over the template's, and the \`usage\` flags of the template are kept next to the task's own.
See [task templates](https://mise.jdx.dev/tasks/templates.html).`,
		triggerSuggest: true,
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
		name: "timeout",
		detail: "Stop the task when it runs longer than this duration",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
		insertText: 'timeout="${1:5m}"',
	},
	{
		name: "skip_if",
		detail:
			"Shell command run before the task: when it exits 0, the task is skipped and counts as successful",
		insertText: 'skip_if="$1"',
	},
	{
		name: "confirm",
		detail: "Prompt for confirmation with this message before running",
		insertText: 'confirm="$1"',
		documentation: `Prompt for confirmation with this message before running.

The table form sets the default answer and custom labels for the answers:

\`\`\`toml
#MISE confirm={message="Deploy to production?", default="no", yes="Ship it", no="Abort"}
\`\`\``,
	},
	{
		name: "secrets",
		detail:
			"[experimental] Secret keys the task receives while it runs. Dependencies do not inherit them",
		insertText: 'secrets=["$1"]',
		documentation: `[experimental] Secret keys the task receives while it runs, read from the project's secrets source. Dependencies do not inherit them, and their values are redacted from the task output.

List the available keys with \`mise secrets ls\`.`,
	},
	{
		name: "daemons",
		detail:
			"[experimental] Project daemons that must be running and ready before the task runs",
		insertText: 'daemons=["$1"]',
		documentation: `[experimental] Project daemons, declared in \`[daemons]\`, that must be running and ready before the task runs. Daemons that already run are left alone.

\`daemons=true\` requires every daemon of the project. See [daemons](https://mise.jdx.dev/daemons.html).`,
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
	{
		name: "interactive",
		detail:
			"Give the task exclusive terminal access while other non-interactive tasks keep running in parallel",
		insertText: "interactive=true",
	},
	{
		name: "vars",
		detail:
			"Values for {{ vars.NAME }} in this task, over the top-level [vars]",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
		insertText: 'vars={${1:name} = "${2:value}"}',
		documentation: `Values available as \`{{ vars.NAME }}\` when mise renders this task. They override the top-level \`[vars]\` and the vars of a task template. They are not exported as environment variables, use \`env\` for that.

See [vars](https://mise.jdx.dev/tasks/task-configuration.html#task-vars).`,
	},
	{
		name: "cache",
		detail: "[experimental] Cache the outputs and logs of a successful run",
		insertText: "cache={ enabled = true }",
		documentation: `[experimental] Store the outputs and logs of a successful run, and restore them when the same inputs come back: \`{ enabled?, audit?, env?, command_inputs? }\`.

See [task caching](https://mise.jdx.dev/tasks/caching.html).`,
	},
	{
		name: "output",
		detail: "Output style of the task (prefix, interleave, keep-order, ...)",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: vscode snippet placeholder
		insertText: 'output="${1|prefix,interleave,keep-order,replacing,timed|}"',
	},
	{
		name: "watch",
		detail: "Options of mise watch for this task",
		insertText: "watch={ no_vcs_ignore = true }",
		documentation: `Options for running the task with \`mise watch\`: \`{ no_vcs_ignore = true }\` also watches the files that \`.gitignore\` and other VCS ignore files leave out.

See [watch](https://mise.jdx.dev/tasks/task-configuration.html#watch).`,
	},
	{
		name: "raw_args",
		detail:
			"Pass every argument, --help included, to the command without parsing it",
		insertText: "raw_args=true",
	},
	{
		name: "deny_all",
		detail:
			"Sandbox: block filesystem, network and inherited env; allow_* adds exceptions",
		insertText: "deny_all=true",
		documentation: `Block filesystem reads and writes, network access, and inherited environment variables. \`allow_*\` entries add exceptions.

See [sandboxing](https://mise.jdx.dev/tasks/task-configuration.html#sandbox): support differs by platform.`,
	},
	{
		name: "deny_read",
		detail: "Sandbox: block filesystem reads",
		insertText: "deny_read=true",
		documentation: `Block filesystem reads, except the system and mise paths the task needs to run.

See [sandboxing](https://mise.jdx.dev/tasks/task-configuration.html#sandbox): support differs by platform.`,
	},
	{
		name: "deny_write",
		detail: "Sandbox: block filesystem writes",
		insertText: "deny_write=true",
		documentation: `Block filesystem writes, except implicitly writable paths such as the temporary directory.

See [sandboxing](https://mise.jdx.dev/tasks/task-configuration.html#sandbox): support differs by platform.`,
	},
	{
		name: "deny_net",
		detail: "Sandbox: block network access",
		insertText: "deny_net=true",
		documentation: `Block network access.

See [sandboxing](https://mise.jdx.dev/tasks/task-configuration.html#sandbox): support differs by platform.`,
	},
	{
		name: "deny_env",
		detail: "Sandbox: drop inherited environment variables",
		insertText: "deny_env=true",
		documentation: `Drop inherited environment variables except \`PATH\`, \`HOME\`, \`USER\`, \`SHELL\`, \`TERM\`, \`COLORTERM\` and \`LANG\`.

See [sandboxing](https://mise.jdx.dev/tasks/task-configuration.html#sandbox): support differs by platform.`,
	},
	{
		name: "allow_read",
		detail: "Sandbox: allow reads from these paths only",
		insertText: 'allow_read=["$1"]',
		documentation: `Allow reads from these paths and block other reads. Relative paths resolve from the working directory of the task.

See [sandboxing](https://mise.jdx.dev/tasks/task-configuration.html#sandbox): support differs by platform.`,
	},
	{
		name: "allow_write",
		detail: "Sandbox: allow writes to these paths only",
		insertText: 'allow_write=["$1"]',
		documentation: `Allow writes to these paths, which also become readable, and block other writes. Relative paths resolve from the working directory of the task.

See [sandboxing](https://mise.jdx.dev/tasks/task-configuration.html#sandbox): support differs by platform.`,
	},
	{
		name: "allow_env",
		detail: "Sandbox: keep these inherited variables only (* wildcards)",
		insertText: 'allow_env=["$1"]',
		documentation: `Keep these inherited variables, with \`*\` wildcards such as \`MYAPP_*\`, and drop the others.

See [sandboxing](https://mise.jdx.dev/tasks/task-configuration.html#sandbox): support differs by platform.`,
	},
	{
		name: "pass_through_env",
		detail:
			"[experimental] Sandbox: keep these variables out of the cache key when env is denied",
		insertText: 'pass_through_env=["$1"]',
		documentation: `[experimental] Keep these inherited variables, with \`*\` wildcards, when environment inheritance is denied, without adding their values to the task cache key.

See [sandboxing](https://mise.jdx.dev/tasks/task-configuration.html#sandbox): support differs by platform.`,
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
	const item = fileTaskConfigItems.find((candidate) => candidate.name === word);
	return item ? (item.documentation ?? item.detail) : undefined;
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
