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
	if (!repo) {
		return;
	}

	if (
		repo.includes("/") &&
		(backendName === "ubi" ||
			backendName === "aqua" ||
			backendName === "asdf" ||
			backendName === "vfox")
	) {
		if (repo?.startsWith("https://")) {
			return repo;
		}
		return `https://github.com/${repo}`;
	}

	if (backendName === "core") {
		return `https://mise.jdx.dev/lang/${repo}`;
	}

	if (backendName === "npm") {
		return `https://www.npmjs.com/package/${repo}`;
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
