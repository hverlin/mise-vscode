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

	// backendName:repo
	const [backendName, repo] = toolInfo.backend.split(":");
	if (!repo || !backendName) {
		return;
	}

	if (
		repo.includes("/") &&
		["ubi", "aqua", "asdf", "vfox", "spm"].includes(backendName)
	) {
		let repoName = repo;
		if (backendName === "ubi") {
			repoName = repo.split("[")[0] as string;
		}

		if (repoName?.startsWith("https://")) {
			return repo;
		}
		return `https://github.com/${repoName}`;
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

	if (backendName === "asdf") {
		const res = await fetch(
			`https://raw.githubusercontent.com/asdf-vm/asdf-plugins/refs/heads/master/plugins/${repo}`,
		);
		const data = await res.text();
		const url = data.match(/(https:\/\/github.com\/[^"]+)/);
		if (url?.[1] && typeof url[1] === "string") {
			return url[1];
		}
	}
};

export const DEPENDS_KEYWORDS = ["depends", "wait_for", "depends_post"];

export function renderDepsArray(deps?: depsArray) {
	if (!deps) {
		return "";
	}

	return deps.map((d) => (typeof d === "string" ? d : d.join(" "))).join(", ");
}
