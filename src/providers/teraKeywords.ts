import vscode, { type MarkdownString } from "vscode";

// The variables, functions, filters and tests of mise's default Tera 2 engine,
// see https://mise.jdx.dev/templates.html

const TEMPLATES_DOCS = "https://mise.jdx.dev/templates.html";

export const teraVariables = [
	{
		name: "env",
		detail: "Access current environment variables (example: env.foo)",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "vars",
		detail: "Access mise.toml variables (example: vars.foo)",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "cwd",
		detail: "Current working directory",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "config_root",
		detail:
			"Directory containing your mise.toml file or the .mise configuration folder",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "config_source",
		detail:
			"Absolute path of the config file the template is in, as reached: symlinks are not resolved",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "mise_bin",
		detail: "Path to current mise executable",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "mise_pid",
		detail: "PID of current mise process",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "mise_env",
		detail:
			"List of the configuration environments selected (MISE_ENV), undefined if none is selected",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "tools",
		detail:
			"Access installed tool information (example: tools.node.version, tools.node.install_path)",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "usage",
		detail:
			"Access task arguments/flags defined with the usage field (example: usage.file). Only available in task run scripts",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "xdg_cache_home",
		detail: "XDG cache home directory",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "xdg_config_home",
		detail: "XDG config home directory",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "xdg_data_home",
		detail: "XDG data home directory",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "xdg_state_home",
		detail: "XDG state home directory",
		kind: vscode.CompletionItemKind.Variable,
	},
	{
		name: "system_brew_prefix",
		detail:
			"Prefix of mise's built-in Homebrew support: /opt/homebrew on macOS, /home/linuxbrew/.linuxbrew elsewhere",
		kind: vscode.CompletionItemKind.Variable,
	},
];

const readStructured = (name: string, format: string, example: string) => ({
	name,
	detail: `Parses a ${format} file - ${name}(path)`,
	insertText: `${name}(path=$1)`,
	documentation: new vscode.MarkdownString(
		`Parses a ${format} file, so a template can use one value from it. Relative paths resolve from the directory of the config file. Index into the result with \`['key']\`:

\`\`\`toml
${example}
\`\`\`

Needs a trusted config and mise 2026.10.15 or later. See [${name}()](${TEMPLATES_DOCS}#read-structured).`,
	),
});

// Note: arg(), option(), and flag() are deprecated in favor of the usage field
// (https://mise.jdx.dev/tasks/task-arguments.html) and are intentionally not suggested.
export const teraFunctions: Array<{
	name: string;
	detail: string;
	insertText: string;
	documentation?: MarkdownString;
}> = [
	{
		name: "range",
		detail: "Returns array of integers - range(end, [start], [step_by])",
		insertText: "range(end=$1)",
	},
	{
		name: "now",
		detail: "Returns the current datetime - now([timezone])",
		insertText: "now()",
	},
	{
		name: "throw",
		detail: "Throws with the message - throw(message)",
		insertText: "throw(message=$1)",
	},
	{
		name: "get_random",
		detail: "Returns a random integer - get_random(start, end, [seed])",
		insertText: "get_random(start=$1, end=$2)",
	},
	{
		name: "get_env",
		detail:
			"Returns the environment variable value  - get_env(name, [default])",
		insertText: "get_env(name=$1)",
	},
	{
		name: "exec",
		detail:
			"Runs shell command and returns output - exec(command, [cache_key], [cache_duration])",
		insertText: "exec(command=$1)",
	},
	{
		name: "read_file",
		detail: "Returns the content of a file - read_file(path)",
		insertText: "read_file(path=$1)",
	},
	readStructured(
		"read_json",
		"JSON",
		`node = "{{ read_json(path='package.json')['volta']['node'] }}"`,
	),
	readStructured(
		"read_yaml",
		"YAML",
		`pulumi = "{{ read_yaml(path='Pulumi.yaml')['requiredPulumiVersion'] }}"`,
	),
	readStructured(
		"read_toml",
		"TOML",
		`mytool = "{{ read_toml(path='pyproject.toml')['tool']['mytool']['version'] }}"`,
	),
	{
		name: "task_source_files",
		detail:
			"Returns the resolved source file paths of the current task (task run scripts only) - task_source_files([only_changed])",
		insertText: "task_source_files()",
	},
	{
		name: "haiku",
		detail:
			"Returns a random haiku-style name - haiku([words], [separator], [digits])",
		insertText: "haiku()",
	},
	{
		name: "arch",
		detail:
			"Returns system architecture (x64, arm64…), renamed with keywords - arch([x64], [arm64])",
		insertText: "arch()",
	},
	{
		name: "os",
		detail:
			"Returns operating system name (linux, macos, windows), renamed with keywords - os([linux], [macos], [windows])",
		insertText: "os()",
	},
	{
		name: "os_family",
		detail: "Returns OS family (unix/windows)",
		insertText: "os_family()",
	},
	{
		name: "libc",
		detail:
			"Returns the C library of the host (gnu, musl), renamed with keywords - libc([gnu], [musl])",
		insertText: "libc()",
	},
	{
		name: "avx2",
		detail:
			"Returns whether the host CPU supports AVX2 (yes, no), renamed with keywords - avx2([yes], [no])",
		insertText: "avx2()",
	},
	{
		name: "num_cpus",
		detail: "Returns number of CPUs",
		insertText: "num_cpus()",
	},
	{
		name: "choice",
		detail: "Generates random string - choice(n, alphabet)",
		insertText: "choice(n=$1, alphabet=$2)",
	},
];

export const teraFilters = [
	{
		name: "default",
		detail:
			"A filter that returns the value if it's not empty, otherwise the default value",
		insertText: "default(value=$1)",
	},
	{ name: "lower", detail: "Converts string to lowercase" },
	{ name: "upper", detail: "Converts string to uppercase" },
	{ name: "capitalize", detail: "Capitalizes first character" },
	{
		name: "replace",
		detail: "Replaces text in string",
		insertText: "replace(from=$1, to=$2)",
	},
	{ name: "title", detail: "Capitalizes each word" },
	{ name: "trim", detail: "Removes leading/trailing whitespace, or pat" },
	{ name: "trim_start", detail: "Removes leading whitespace, or pat" },
	{ name: "trim_end", detail: "Removes trailing whitespace, or pat" },
	{
		name: "truncate",
		detail: "Truncates string to length",
		insertText: "truncate(length=$1)",
	},
	{ name: "quote", detail: "Quotes a string for the shell" },
	{
		name: "split",
		detail: "Splits string by pattern",
		insertText: "split(pat=$1)",
	},
	{
		name: "join",
		detail: "Joins array with separator",
		insertText: "join(sep=$1)",
	},
	{ name: "indent", detail: "Indents lines of a string" },
	{ name: "striptags", detail: "Removes HTML tags" },
	{ name: "spaceless", detail: "Removes whitespace between HTML tags" },
	{ name: "escape_html", detail: "Escapes HTML special characters" },
	{ name: "escape_xml", detail: "Escapes XML special characters" },
	{ name: "newlines_to_br", detail: "Converts line breaks to <br> tags" },
	{ name: "slugify", detail: "Converts to a URL-friendly slug" },
	{ name: "wordcount", detail: "Returns the number of words" },
	{
		name: "pluralize",
		detail:
			"Returns a plural suffix for a number - pluralize([singular], [plural])",
	},
	{
		name: "regex_replace",
		detail: "Replaces text matching a regex",
		insertText: "regex_replace(pattern=$1, rep=$2)",
	},

	{ name: "first", detail: "Returns first element" },
	{ name: "last", detail: "Returns last element" },
	{ name: "nth", detail: "Returns the nth element", insertText: "nth(n=$1)" },
	{ name: "length", detail: "Returns length of string/array" },
	{ name: "reverse", detail: "Reverses string/array" },
	{ name: "sort", detail: "Sorts an array" },
	{ name: "unique", detail: "Removes duplicates from an array" },
	{ name: "shuffle", detail: "Shuffles an array randomly" },
	{
		name: "get",
		detail: "Returns the value of a key of a map - get(key, [default])",
		insertText: "get(key=$1)",
	},
	{ name: "keys", detail: "Returns the keys of a map" },
	{ name: "values", detail: "Returns the values of a map" },
	{ name: "pairs", detail: "Returns the [key, value] pairs of a map" },
	{
		name: "group_by",
		detail: "Groups an array of maps by an attribute",
		insertText: "group_by(attribute=$1)",
	},

	{
		name: "absolute",
		detail: "Converts to absolute path without resolving symlinks",
	},
	{
		name: "canonicalize",
		detail: "Converts to absolute path and resolves symlinks",
	},
	{ name: "basename", detail: "Extracts filename from path" },
	{ name: "dirname", detail: "Returns directory path" },
	{ name: "extname", detail: "Returns file extension" },
	{ name: "file_stem", detail: "Returns filename without extension" },
	{ name: "file_size", detail: "Returns file size in bytes" },
	{ name: "last_modified", detail: "Returns last modified time" },
	{ name: "join_path", detail: "Joins path segments" },

	{
		name: "hash",
		detail: "Generates SHA256 (or BLAKE3) hash",
		insertText: "hash(len=$1)",
	},
	{
		name: "hash_file",
		detail: "Returns file BLAKE3 hash",
		insertText: "hash_file(len=$1)",
	},
	{ name: "urlencode", detail: "URL encodes string" },
	{
		name: "urlencode_strict",
		detail: "URL encodes string including / characters",
	},
	{ name: "b64_encode", detail: "Encodes string as base64" },
	{ name: "b64_decode", detail: "Decodes a base64 string" },
	{
		name: "date",
		detail: "Formats a timestamp",
		insertText: "date(format=$1)",
	},
	{ name: "json_encode", detail: "Encodes value as JSON" },
	{
		name: "format",
		detail: "Formats a value with a format spec",
		insertText: "format(spec=$1)",
	},
	{
		name: "filesize_format",
		detail: "Formats bytes as a human-readable file size",
	},
	{ name: "int", detail: "Converts to integer" },
	{ name: "float", detail: "Converts to float" },
	{ name: "str", detail: "Converts to string" },
	{ name: "round", detail: "Rounds a number - round([method], [precision])" },
	{ name: "abs", detail: "Returns absolute value of a number" },

	{ name: "kebabcase", detail: "Converts to kebab-case" },
	{ name: "lowercamelcase", detail: "Converts to lowerCamelCase" },
	{ name: "uppercamelcase", detail: "Converts to UpperCamelCase" },
	{ name: "shoutykebabcase", detail: "Converts to SHOUTY-KEBAB-CASE" },
	{ name: "snakecase", detail: "Converts to snake_case" },
	{ name: "shoutysnakecase", detail: "Converts to SHOUTY_SNAKE_CASE" },
];

/** Used after `is`, as in `{% if os() is starting_with(pat="mac") %}` */
export const teraTests = [
	{ name: "defined", detail: "The variable is defined" },
	{ name: "undefined", detail: "The variable is not defined" },
	{ name: "string", detail: "The value is a string" },
	{ name: "number", detail: "The value is a number" },
	{ name: "integer", detail: "The value is an integer" },
	{ name: "float", detail: "The value is a float" },
	{ name: "bool", detail: "The value is a boolean" },
	{ name: "array", detail: "The value is an array" },
	{ name: "map", detail: "The value is a map" },
	{ name: "none", detail: "The value is none" },
	{ name: "iterable", detail: "The value can be iterated over" },
	{ name: "odd", detail: "The number is odd" },
	{ name: "even", detail: "The number is even" },
	{
		name: "divisible_by",
		detail: "The number is divisible by divisor",
		insertText: "divisible_by(divisor=$1)",
	},
	{
		name: "starting_with",
		detail: "The value starts with pat",
		insertText: "starting_with(pat=$1)",
	},
	{
		name: "ending_with",
		detail: "The value ends with pat",
		insertText: "ending_with(pat=$1)",
	},
	{
		name: "containing",
		detail: "The value contains pat",
		insertText: "containing(pat=$1)",
	},
	{
		name: "matching",
		detail: "The string matches the regular expression pat",
		insertText: "matching(pat=$1)",
	},
	{ name: "dir", detail: "The path is a directory" },
	{ name: "file", detail: "The path is a file" },
	{ name: "exists", detail: "The path exists" },
	{
		name: "before",
		detail: "The date is before other - before(other, [inclusive])",
		insertText: "before(other=$1)",
	},
	{
		name: "after",
		detail: "The date is after other - after(other, [inclusive])",
		insertText: "after(other=$1)",
	},
	{
		name: "semver_matching",
		detail: "The version matches a semver requirement",
		insertText: "semver_matching(requirement=$1)",
	},
];

/**
 * The Tera v1 filters and tests mise still accepts, with a warning, until
 * 2027.4.0: not suggested, but explained on hover
 */
const deprecatedTeraFilters: Record<string, string> = {
	as_str: "`str`",
	escape: "`escape_html`",
	linebreaksbr: "`newlines_to_br`",
	addslashes: "an explicit `replace(from=..., to=...)`",
	trim_start_matches: '`trim_start(pat="...")`',
	trim_end_matches: '`trim_end(pat="...")`',
	slice: "`items[0:2]`",
	concat: "`[...items, ...extra_items]`",
	map: "`[item.name for item in items]`",
	filter: "`[item for item in items if item.active]`",
};
const deprecatedTeraTests: Record<string, string> = {
	object: "`map`",
	divisibleby: "`divisible_by(divisor=...)`",
};

const deprecated = (kind: string, name: string, replacement: string) =>
	new vscode.MarkdownString(
		`Tera v1 ${kind} \`${name}\`, deprecated: use ${replacement} instead. mise 2027.4.0 removes it. See [Migrating from Tera v1](${TEMPLATES_DOCS}#tera-v2-migration).`,
	);

// Tera 2 has no macros, and mise renders each template on its own, without
// other templates to include or extend
export const teraKeywords = [
	"if",
	"else",
	"elif",
	"endif",
	"for",
	"endfor",
	"break",
	"continue",
	"set",
	"set_global",
	"filter",
	"endfilter",
	"component",
	"endcomponent",
	"raw",
	"endraw",
	"and",
	"or",
	"not",
	"in",
	"is",
].map((keyword) => ({
	name: keyword,
	kind: vscode.CompletionItemKind.Keyword,
}));

/** What can be typed at the end of a Tera expression */
export type TeraCompletionContext =
	| "filter"
	| "test"
	| "attribute"
	| "expression";

/** `{% filter upper %}` applies a filter to a block */
const FILTER_TAG = /\{%-?\s*filter\s+$/;

export function getTeraCompletionContext(
	linePrefix: string,
): TeraCompletionContext {
	const beforeWord = linePrefix.replace(/\w*$/, "");
	if (/\|\s*$/.test(beforeWord) || FILTER_TAG.test(beforeWord)) {
		return "filter";
	}
	if (/\bis\s+(?:not\s+)?$/.test(beforeWord)) {
		return "test";
	}
	if (beforeWord.endsWith(".")) {
		return "attribute";
	}
	return "expression";
}

const hoverOf = (entry: { detail: string; documentation?: MarkdownString }) =>
	entry.documentation ?? new vscode.MarkdownString(entry.detail);

/**
 * What a word of a Tera expression stands for, from where it is: a filter
 * after `|`, a test after `is`, a function before `(`, otherwise a variable.
 */
export function getTeraHoverInformation(
	word: string,
	textBefore: string,
	textAfter: string,
): MarkdownString | undefined {
	const named = <T extends { name: string }>(entries: T[]) =>
		entries.find((entry) => entry.name === word);

	if (/\|\s*$/.test(textBefore) || FILTER_TAG.test(textBefore)) {
		const filter = named(teraFilters);
		const replacement = deprecatedTeraFilters[word];
		return filter
			? hoverOf(filter)
			: replacement
				? deprecated("filter", word, replacement)
				: undefined;
	}
	if (/\bis\s+(?:not\s+)?$/.test(textBefore)) {
		const test = named(teraTests);
		const replacement = deprecatedTeraTests[word];
		return test
			? hoverOf(test)
			: replacement
				? deprecated("test", word, replacement)
				: undefined;
	}
	if (/\.\s*$/.test(textBefore)) {
		return undefined;
	}
	const entry =
		(/^\s*\(/.test(textAfter) ? named(teraFunctions) : undefined) ??
		named(teraVariables);
	return entry ? hoverOf(entry) : undefined;
}
