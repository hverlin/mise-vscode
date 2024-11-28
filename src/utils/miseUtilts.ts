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
