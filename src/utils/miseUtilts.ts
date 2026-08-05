export const allowedFileTaskDirs = [
	"mise-tasks",
	".mise-tasks",
	"mise/tasks",
	".mise/tasks",
	".config/mise/tasks",
];

export const misePatterns = [
	".config/mise/config.toml",
	"mise/config.toml",
	"mise.toml",
	".mise/config.toml",
	".mise.toml",
	".config/mise/config.local.toml",
	"mise/config.local.toml",
	"mise.local.toml",
	".mise/config.local.toml",
	".mise.local.toml",
	".config/mise/config.*.toml",
	"mise/config.*.toml",
	"mise.*.toml",
	".mise/config.*.toml",
	".mise.*.toml",
	".config/mise/config.*.local.toml",
	"mise/config.*.local.toml",
	".mise/config.*.local.toml",
	".mise.*.local.toml",
].join(",");

export const idiomaticFileToTool = {
	".crystal-version": "crystal",
	".exenv-version": "elixir",
	".go-version": "go",
	"go.mod": "go",
	".java-version": "java",
	".sdkmanrc": "java",
	".nvmrc": "node",
	".node-version": "node",
	".python-version": "python",
	".python-versions": "python",
	".ruby-version": "ruby",
	Gemfile: "ruby",
	".terraform-version": "terraform",
	".packer-version": "packer",
	"main.tf": "terraform",
	".yarnrc": "yarn",
} as const;

export const idiomaticFiles = new Set(Object.keys(idiomaticFileToTool));

export const TOOLS_MAPPING = [
	["node", "nodejs"] as const,
	["go", "golang"] as const,
] as const;

export function isToolVersionsFile(fileName: string): boolean {
	return fileName.split(/[\\/]/).pop() === ".tool-versions";
}

export const getCleanedToolName = (toolName: string) => {
	return toolName
		.trim()
		.replace(/(['"])/g, "")
		.replace("nodejs", "node")
		.replace("golang", "go");
};

type JSONType = "string" | "boolean" | "number" | "object" | "array";

export type FlattenedProperty = {
	key: string;
	type: JSONType;
	itemsType: JSONType | undefined;
	enum: string[] | undefined;
	description: string | undefined;
	defaultValue: unknown;
	deprecated?: string;
};

type PropertyValue = {
	type?: JSONType;
	description?: string;
	default?: unknown;
	deprecated?: string;
	items?: { type: JSONType };
	enum?: string[];
	properties?: Record<string, PropertyValue>;
};

type SchemaType = {
	properties: Record<string, PropertyValue>;
};

export function flattenJsonSchema(
	schema: SchemaType,
	parentKey = "",
	result: FlattenedProperty[] = [],
): FlattenedProperty[] {
	if (!schema.properties) {
		return result;
	}

	for (const [key, value] of Object.entries(schema.properties)) {
		const currentKey = parentKey ? `${parentKey}.${key}` : key;

		if (value.properties) {
			flattenJsonSchema({ properties: value.properties }, currentKey, result);
		} else {
			result.push({
				key: currentKey,
				type: value.type ?? "string",
				itemsType: value.items?.type,
				description: value.description,
				defaultValue: value.default,
				enum: value.enum,
				...(value.deprecated && { deprecated: value.deprecated }),
			});
		}
	}

	return result;
}

export function getDefaultForType(type?: string): unknown {
	switch (type) {
		case "string":
			return "";
		case "boolean":
			return false;
		case "number":
			return 0;
		case "object":
			return {};
		case "array":
			return [];
		default:
			return undefined;
	}
}

export const getWebsiteForTool = async (toolInfo: MiseToolInfo) => {
	if (!toolInfo?.backend) {
		return;
	}
	return getWebsiteFromToolName(toolInfo.backend, toolInfo.tool_options);
};

export const getWebsiteFromToolName = (
	toolName: string,
	toolOptions?: MiseToolInfo["tool_options"],
): string | undefined => {
	if (!toolName) {
		return undefined;
	}

	const [backendName, repo] = toolName.split(":");
	if (!repo || !backendName) {
		return undefined;
	}

	return toWebUrl(getWebsiteFromParts(backendName, repo, toolOptions));
};

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * The result is only ever shown as a link or handed to `openExternal`, so it
 * has to be a web address. Several backends return their tool option verbatim,
 * and tool options come from configuration files: anything that does not end up
 * as http(s) is dropped rather than handed to the OS protocol handler.
 */
export const toWebUrl = (website: string | undefined): string | undefined => {
	if (!website) {
		return undefined;
	}

	const candidate = website.replace(/^git\+/, "").replace(/^git:\/\//, "");
	const withScheme = HAS_SCHEME.test(candidate)
		? candidate
		: `https://${candidate}`;

	try {
		const url = new URL(withScheme);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.toString()
			: undefined;
	} catch {
		return undefined;
	}
};

const getWebsiteFromParts = (
	backendName: string,
	repo: string,
	toolOptions?: MiseToolInfo["tool_options"],
): string | undefined => {
	if (backendName === "aqua") {
		const repoName = repo.split("/").slice(0, 2).join("/");
		return `https://github.com/${repoName}`;
	}

	if (backendName === "ubi") {
		const repoName =
			repo.split("[")[0]?.split("/").slice(0, 2).join("/") || repo;
		const domain =
			toolOptions?.provider === "gitlab" ? "gitlab.com" : "github.com";
		return `https://${domain}/${repoName}`;
	}

	if (backendName === "spm") {
		if (repo.startsWith("https://") || repo.startsWith("http://")) {
			return repo;
		}
		const domain =
			toolOptions?.provider === "gitlab" ? "gitlab.com" : "github.com";
		return `https://${domain}/${repo}`;
	}

	if (backendName === "vfox") {
		return `https://github.com/${repo}`;
	}

	if (backendName === "github") {
		if (toolOptions?.api_url) {
			const url = new URL(toolOptions.api_url);
			return `${url.protocol}//${url.hostname}/${repo}`;
		}
		return `https://github.com/${repo}`;
	}

	if (backendName === "gitlab") {
		if (toolOptions?.api_url) {
			const url = new URL(toolOptions.api_url);
			return `${url.protocol}//${url.hostname}/${repo}`;
		}
		return `https://gitlab.com/${repo}`;
	}

	if (backendName === "http") {
		if (toolOptions?.url) {
			return toolOptions.url;
		}
		return "https://mise.jdx.dev/dev-tools/backends/http";
	}

	if (backendName === "core") {
		return `https://mise.jdx.dev/lang/${repo}`;
	}

	if (backendName === "npm") {
		return `https://www.npmjs.com/package/${repo}`;
	}

	if (backendName === "cargo") {
		return `https://crates.io/crates/${repo}`;
	}

	if (backendName === "gem") {
		return `https://rubygems.org/gems/${repo}`;
	}

	if (backendName === "go") {
		return `https://pkg.go.dev/${repo}`;
	}

	if (backendName === "pipx") {
		if (repo.startsWith("git+")) {
			return repo.replace("git+", "");
		}
		if (repo.startsWith("https://")) {
			return repo;
		}
		if (repo.includes("/")) {
			return `https://github.com/${repo}`;
		}
		return `https://pypi.org/project/${repo}`;
	}

	if (backendName === "dotnet") {
		return `https://www.nuget.org/packages/${repo}`;
	}

	if (backendName === "conda") {
		const channel = toolOptions?.channel || "conda-forge";
		return `https://anaconda.org/${channel}/${repo}`;
	}

	if (backendName === "asdf") {
		if (repo.startsWith("http")) {
			return repo;
		}
		return `https://github.com/${repo}`;
	}

	return undefined;
};

export const DEPENDS_KEYWORDS = [
	"depends",
	"wait_for",
	"depends_post",
] as const;

type DEPEND_KEYWORD = (typeof DEPENDS_KEYWORDS)[number];

export function isDependsKeyword(keyword: string): keyword is DEPEND_KEYWORD {
	return DEPENDS_KEYWORDS.includes(keyword as DEPEND_KEYWORD);
}

export function renderDepsArray(deps?: depsArray) {
	if (!deps) {
		return "";
	}

	return deps
		.map((d) => {
			if (typeof d === "string") {
				return d;
			}
			if (Array.isArray(d)) {
				return d.join(" ");
			}
			return d.optional ? `${d.task} (optional)` : d.task;
		})
		.join(", ");
}

export const isMiseTomlFile = (filename: string) => {
	return (
		/mise\.[^.]*\.?toml$/.test(filename) || filename.endsWith("config.toml")
	);
};

/**
 * Whether a mise command failed only because a config file does not parse.
 *
 * Every mise query fails this way while a config file is being edited: with
 * auto save on, a half-typed line reaches disk and mise exits non-zero with no
 * output at all. That is transient and says nothing about the machine, so the
 * views keep their previous state instead of emptying on each keystroke.
 */
export function isMiseConfigParseError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		/TOML parse error/i.test(message) ||
		/invalid TOML in config file/i.test(message) ||
		/error parsing config file/i.test(message)
	);
}

/** Suffix marking a config file the extension could not parse, in tree views */
export const UNPARSED_CONFIG_DESCRIPTION = "does not parse";

export const UNPARSED_CONFIG_TOOLTIP =
	"This config file does not parse, so what is listed here is the last state it was readable in.";

export type MiseErrorKind = "parse" | "settings" | "unknown";

export type ParsedMiseError = {
	kind: MiseErrorKind;
	/** config file the error points at, when mise names one */
	file?: string;
	/** 1-based, as mise reports them */
	line?: number;
	column?: number;
	/** what mise says is wrong, e.g. "invalid basic string, expected `\"`" */
	reason?: string;
};

/**
 * Pull the useful parts out of a failed mise command, so a view can say what is
 * wrong instead of "Error loading tasks".
 *
 * mise renders the same problem in more than one shape, and only some of them
 * name the file, so every field is optional. Anything unrecognised stays
 * `unknown`, which the views fall back to.
 */
export function parseMiseError(error: unknown): ParsedMiseError {
	const message = error instanceof Error ? error.message : String(error);

	// `× Invalid TOML in config file: <path>` followed by `╭─[<path>:<line>:<col>]`
	// and `╰── <reason>`. The path is wrapped across lines in the box drawing, so
	// it is read from the location marker rather than from the title
	const located = message.match(/╭─\[([^\]]+?):(\d+):(\d+)\]/);
	// `╰──` also draws the bottom border of the snippet box, so only the ones
	// that carry words are the reason
	const boxedReason = [...message.matchAll(/╰──+[^\S\n]*(.*)/g)]
		.map((match) => match[1]?.trim())
		.find((text) => text && /[a-z]/i.test(text));
	if (located) {
		return {
			kind: "parse",
			file: located[1],
			line: Number(located[2]),
			column: Number(located[3]),
			reason: boxedReason,
		};
	}

	// `TOML parse error at line <line>, column <col>` with the reason on its own
	// line after the snippet. This shape never names the file
	const positioned = message.match(
		/TOML parse error at line (\d+), column (\d+)/,
	);
	if (positioned) {
		const reason = message
			.split("\n")
			.map((line) => line.trim())
			.find(
				(line) =>
					line.length > 0 &&
					/[a-z]/i.test(line) &&
					!line.startsWith("|") &&
					!/^\d+ \|/.test(line) &&
					!line.startsWith("^") &&
					!line.includes("TOML parse error") &&
					!line.startsWith("Command failed:"),
			);
		return {
			kind: "parse",
			line: Number(positioned[1]),
			column: Number(positioned[2]),
			reason,
		};
	}

	// `invalid type: string "x", expected usize` / `in \`settings.jobs\``
	const settings = message.match(/Error loading settings file: (.+)/);
	if (settings?.[1]) {
		const key = message.match(/in `([^`]+)`/);
		return {
			kind: "settings",
			reason: key ? `${settings[1].trim()} (${key[1]})` : settings[1].trim(),
		};
	}

	return { kind: "unknown" };
}
