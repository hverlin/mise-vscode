import vscode, { type MarkdownString } from "vscode";

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
			"Current configuration environment (MISE_ENV), undefined if not set",
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
];

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
		insertText: "range(end=$1, start=$2, step_by=$3)",
	},
	{
		name: "now",
		detail: "Returns the current datetime - now([timezone])",
		insertText: "now()",
	},
	{
		name: "throw",
		detail: "Throws with the message - throw(message)",
		insertText: "throw($1)",
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
		insertText: "get_env(name=$1, default=$2)",
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
	{
		name: "task_source_files",
		detail:
			"Returns the resolved source file paths of the current task (task run scripts only) - task_source_files()",
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
		detail: "Returns system architecture - arch()",
		insertText: "arch()",
	},
	{
		name: "os",
		detail: "Returns operating system name - os()",
		insertText: "os()",
	},
	{
		name: "os_family",
		detail: "Returns OS family (unix/windows)",
		insertText: "os_family()",
	},
	{
		name: "num_cpus",
		detail: "Returns number of CPUs",
		insertText: "num_cpus()",
	},
	{
		name: "choice",
		detail: "Generates random string - choice(n, alphabet)",
		insertText: "choice($1, $2)",
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
	{ name: "trim", detail: "Removes leading/trailing whitespace" },
	{ name: "trim_start", detail: "Removes leading whitespace" },
	{ name: "trim_end", detail: "Removes trailing whitespace" },
	{
		name: "trim_start_matches",
		detail: "Removes leading occurrences of a pattern",
		insertText: "trim_start_matches(pat=$1)",
	},
	{
		name: "trim_end_matches",
		detail: "Removes trailing occurrences of a pattern",
		insertText: "trim_end_matches(pat=$1)",
	},
	{ name: "truncate", detail: "Truncates string to length" },
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
	{ name: "addslashes", detail: "Escapes quotes with backslashes" },
	{ name: "linebreaksbr", detail: "Converts line breaks to <br> tags" },
	{ name: "striptags", detail: "Removes HTML tags" },
	{ name: "spaceless", detail: "Removes whitespace between HTML tags" },
	{ name: "slugify", detail: "Converts to a URL-friendly slug" },
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
	{
		name: "concat",
		detail: "Appends to an array",
		insertText: "concat(with=$1)",
	},
	{
		name: "map",
		detail: "Extracts an attribute from each element",
		insertText: "map(attribute=$1)",
	},
	{ name: "shuffle", detail: "Shuffles an array randomly" },

	{
		name: "absolute",
		detail: "Converts to absolute path without resolving symlinks",
	},
	{ name: "canonicalize", detail: "Converts to absolute path" },
	{ name: "basename", detail: "Extracts filename from path" },
	{ name: "dirname", detail: "Returns directory path" },
	{ name: "extname", detail: "Returns file extension" },
	{ name: "file_stem", detail: "Returns filename without extension" },
	{ name: "file_size", detail: "Returns file size in bytes" },
	{ name: "last_modified", detail: "Returns last modified time" },
	{ name: "join_path", detail: "Joins path segments" },

	{ name: "hash", detail: "Generates SHA256 hash", insertText: "hash(len=$1)" },
	{
		name: "hash_file",
		detail: "Returns file SHA256 hash",
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
	{ name: "as_str", detail: "Converts to string" },
	{ name: "abs", detail: "Returns absolute value of a number" },

	{ name: "kebabcase", detail: "Converts to kebab-case" },
	{ name: "lowercamelcase", detail: "Converts to lowerCamelCase" },
	{ name: "uppercamelcase", detail: "Converts to UpperCamelCase" },
	{ name: "shoutykebabcase", detail: "Converts to SHOUTY-KEBAB-CASE" },
	{ name: "snakecase", detail: "Converts to snake_case" },
	{ name: "shoutysnakecase", detail: "Converts to SHOUTY_SNAKE_CASE" },
];

export const teraKeywords = [
	"if",
	"else",
	"elif",
	"endif",
	"for",
	"endfor",
	"raw",
	"endraw",
	"block",
	"endblock",
	"macro",
	"endmacro",
	"set",
	"include",
	"import",
	"as",
	"and",
	"or",
	"not",
	"in",
].map((keyword) => ({
	name: keyword,
	kind: vscode.CompletionItemKind.Keyword,
}));

function buildHoverInformation() {
	const hoverMap = new Map<string, string | MarkdownString>();
	for (const fn of teraFunctions) {
		hoverMap.set(
			fn.name,
			fn.documentation || new vscode.MarkdownString(fn.detail),
		);
	}
	for (const filter of teraFilters) {
		hoverMap.set(filter.name, new vscode.MarkdownString(filter.detail));
	}
	for (const variable of teraVariables) {
		hoverMap.set(variable.name, new vscode.MarkdownString(variable.detail));
	}

	return hoverMap;
}
export const teraHoverInformation = buildHoverInformation();
