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

	return getWebsiteFromParts(backendName, repo, toolOptions);
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

	return deps.map((d) => (typeof d === "string" ? d : d.join(" "))).join(", ");
}

export const isMiseTomlFile = (filename: string) => {
	return (
		/mise\.[^.]*\.?toml$/.test(filename) || filename.endsWith("config.toml")
	);
};
