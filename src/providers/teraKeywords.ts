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

export const teraFunctions = [
	{
		name: "arg",
		detail:
			'Define a positional argument for a task. Example: arg(name="file", i=1, var=false)',
		documentation: new vscode.MarkdownString(
			`Define a positional argument for a task where order matters.

Parameters:
- \`name\`: The name of the argument (used in help/error messages)
- \`i\`: Index to specify argument order (optional)
- \`var\`: If true, allows multiple values (optional)
- \`default\`: Default value if not provided (optional)

Example:
\`\`\`toml
[tasks.test]
run = 'cargo test {{arg(name="file")}}'
# mise run test my-test-file
# -> cargo test my-test-file
\`\`\`
`,
		),
		insertText: 'arg(name="$1"${2:, i=${3:1}}${4:}${5:, default="$6"})',
	},
	{
		name: "option",
		detail:
			'Define a named option for a task. Example: option(name="file", var=false)',
		documentation: new vscode.MarkdownString(
			`Define a named argument for a task where order doesn't matter.

Parameters:
- \`name\`: The name of the option (used in help/error messages)
- \`var\`: If true, allows multiple values (optional)
- \`default\`: Default value if not provided (optional)

Example:
\`\`\`toml
run = 'cargo test {{option(name="file")}}'
# mise run test --file my-test-file
# -> cargo test my-test-file
\`\`\``,
		),
		insertText: 'option(name="$1"${2:}${4:, default="$5"})',
	},
	{
		name: "flag",
		detail: 'Define a boolean flag for a task. Example: flag(name="verbose")',
		documentation: new vscode.MarkdownString(
			`Define a boolean flag for a task that doesn't take values.

Parameters:
- \`name\`: The name of the flag (used in help/error messages)

Example:
\`\`\`toml
run = 'cargo test {{flag(name="verbose")}}'
# mise run test --verbose
# -> cargo test --verbose
\`\`\``,
		),
		insertText: 'flag(name="$1")',
	},
	{
		name: "range",
		detail: "Returns array of integers - range(end, [start], [step_by])",
		insertText: "range(end=$1, start=$2, step_by=$3)",
	},
	{
		name: "now",
		detail: "Returns datetime or timestamp - now([timestamp], [utc])",
		insertText: "now()",
	},
	{
		name: "throw",
		detail: "Throws with the message - throw(message)",
		insertText: "throw($1)",
	},
	{
		name: "get_random",
		detail: "Returns a random integer - get_random(end, [start])",
		insertText: "get_random(end=$1, start=$2)",
	},
	{
		name: "get_env",
		detail:
			"Returns the environment variable value  - get_env(name, [default])",
		insertText: "get_env(name=$1, default=$2)",
	},
	{
		name: "exec",
		detail: "Runs shell command and returns output - exec(command)",
		insertText: "exec(command=$1)",
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
	{ name: "truncate", detail: "Truncates string to length" },
	{ name: "first", detail: "Returns first element" },
	{ name: "last", detail: "Returns last element" },
	{ name: "length", detail: "Returns length of string/array" },
	{ name: "reverse", detail: "Reverses string/array" },
	{ name: "urlencode", detail: "URL encodes string" },

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

	{ name: "kebabcase", detail: "Converts to kebab-case" },
	{ name: "lowercamelcase", detail: "Converts to lowerCamelCase" },
	{ name: "uppercamelcase", detail: "Converts to UpperCamelCase" },
	{ name: "shoutycamelcase", detail: "Converts to SHOUTY_CAMEL_CASE" },
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
