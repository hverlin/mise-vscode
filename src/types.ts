/** biome-ignore-all lint/correctness/noUnusedVariables: export types */

/** provider-suggested entries (e.g. imported from turbo.json) are objects */
type depsArray = Array<
	string | string[] | { task: string; optional?: boolean }
>;

type MiseTask = {
	name: string;
	/** e.g. `fmt` for a toml task, `//projects/frontend:test` for a workspace script task */
	aliases?: string[];
	source: string;
	description: string;
	// TODO: only in 2025.1.4. Force to upgrade mise version and remove the `?` later
	depends?: depsArray;
	depends_post?: depsArray;
	wait_for?: depsArray;
	env?: Record<string, string>;
	dir?: string;
	hide?: boolean;
	raw?: boolean;
	sources?: string[];
	outputs?: string[];
	shell?: string;
	quiet?: boolean;
	silent?: boolean;
	tools?: Record<string, string>;
	run?: string[];
	file?: string;
};

type MiseToolSource = {
	type: string;
	path: string;
};

/** A project of the workspace graph reported by `mise tasks graph --json` */
type MiseProject = {
	/** e.g. `node:frontend`, `cargo:my-crate`, `uv:my-pkg`, `go:example.com/mod` */
	id: string;
	/** path relative to the monorepo root, e.g. `projects/frontend` */
	root: string;
	metadata?: Record<string, string>;
	/** ids of the projects this project depends on */
	dependencies?: string[];
};

type MiseTool = {
	name: string;
	version: string;
	source?: MiseToolSource;
	requested_version: string;
	installed: boolean;
	active: boolean;
	install_path: string;
};

type MiseToolUpdate = {
	name: string;
	version: string;
	requested_version: string;
	latest: string | null;
	bump?: string | null;
	source?: MiseToolSource;
};

type MiseEnv = {
	name: string;
	value: string;
};

type MiseEnvWithInfo = MiseEnv & {
	source?: string;
	tool?: string;
};

type MiseSettingInfo = {
	value: string | number | boolean | string[] | number[] | boolean[] | object;
	source?: string;
};

type MiseToolInfo = {
	backend: string;
	description: string | null;
	installed_versions: string[];
	requested_versions: string[] | null;
	active_versions: string[] | null;
	config_source: { type: string; path: string } | null;
	tool_options: {
		os?: string | null;
		install_env?: Record<string, string>;
		api_url?: string | null;
		url?: string | null;
		provider?: string | null;
		channel?: string | null;
	};
};

type MiseDirs = {
	data?: string;
	config?: string;
	cache?: string;
	state?: string;
	shims: string;
	[key: string]: string | undefined;
};

type MiseConfig = {
	dirs: MiseDirs;
	self_update_available?: boolean;
};

type MiseBootstrapPackage = {
	package: string;
	requested_version: string;
	/** e.g. `installed`, `missing` */
	state: string;
	installed_version: string;
};

type MiseBootstrapPackageManager = {
	available: boolean;
	packages: MiseBootstrapPackage[];
};

type MiseBootstrapRepo = {
	path: string;
	path_raw: string;
	url: string;
	ref: string | null;
	origin: string | null;
	current_ref: string | null;
	current_sha: string | null;
	state: string;
	reason: string;
};

type MiseBootstrapDotfile = {
	target: string;
	source: string;
	mode: string;
	/** e.g. `applied`, `missing`, `source_missing`, `differs` */
	state: string;
};

type MiseBootstrapShellActivation = {
	/** e.g. `zshrc` */
	target: string;
	shell: string;
	path: string;
	/** e.g. `activate`, `shims` */
	mode: string;
	state: string;
};

type MiseBootstrapMacosDefault = {
	domain: string;
	key: string;
	value: unknown;
	current: string | null;
	/** e.g. `set`, `differs` */
	state: string;
};

type MiseBootstrapLaunchdAgent = {
	name: string;
	label: string;
	path: string;
	loaded: boolean;
	state: string;
};

type MiseBootstrapSystemdUnit = {
	name: string;
	unit: string;
	state: string;
};

type MiseBootstrapLoginShell = {
	available: boolean;
	shell: string;
	user: string;
	current: string | null;
	shell_listed: boolean;
	state: string;
};

type MiseBootstrapTool = {
	tool: string;
	requested_version: string;
	resolved_version: string;
	state: string;
	installed: boolean;
};

/** Output of `mise bootstrap status --json` */
type MiseBootstrapStatus = {
	packages: Record<string, MiseBootstrapPackageManager>;
	repos: MiseBootstrapRepo[];
	dotfiles: {
		files: MiseBootstrapDotfile[];
		edits: MiseBootstrapDotfile[];
	};
	mise_shell_activate: MiseBootstrapShellActivation[];
	macos_defaults: { available?: boolean; entries: MiseBootstrapMacosDefault[] };
	launchd: { available?: boolean; agents: MiseBootstrapLaunchdAgent[] };
	systemd: {
		available?: boolean;
		reason?: string;
		units: MiseBootstrapSystemdUnit[];
	};
	login_shell: MiseBootstrapLoginShell | null;
	tools: MiseBootstrapTool[];
	plugin_deps?: unknown[];
};

/*
	{
		"version": "2025.3.2 windows-x64 (2025-03-07)",
		"latest": "2025.3.2",
		"os": "windows",
		"arch": "x64",
		"build_time": "2025-03-07 16:41:51 +00:00"
	}
*/
type MiseVersion = {
	version: string;
	latest: string | null;
	os: string;
	arch: string;
	build_time: string;
};
