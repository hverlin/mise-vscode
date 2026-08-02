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
	/** which provider inferred the project, from which manifest */
	provenance?: { provider?: string; source?: string };
};

type MiseProjectConfigFile = {
	path: string;
	/** idiomatic version file (`.nvmrc`, `go.mod`, ...) rather than a mise config */
	idiomatic: boolean;
};

type MiseProjectTool = {
	name: string;
	/** requested version, formatted for display */
	version: string;
	/** config file requesting this version */
	source: string;
	/** requested by an idiomatic version file rather than a mise config */
	idiomatic: boolean;
	/** version requested by the global config, when the tool is defined there */
	globalVersion?: string;
	/** requests a different version than the global config default */
	overridesGlobal: boolean;
	/** resolved version reported by `mise ls --all-sources`, when available */
	resolvedVersion?: string;
	/** whether the resolved version is installed, when reported by mise */
	installed?: boolean;
};

/** A directory with mise configuration, shown in the Projects webview */
type MiseProjectEntry = {
	rootDir: string;
	configs: MiseProjectConfigFile[];
	tools: MiseProjectTool[];
	/** false when only idiomatic version files were found */
	hasMiseConfig: boolean;
};

/** One config file in the flat (per-file) view of the Projects webview */
type MiseProjectFlatConfigFile = {
	path: string;
	idiomatic: boolean;
	/** part of the global config rather than a project */
	global: boolean;
	tools: Record<string, string>;
};

type MiseProjectsData = {
	projects: MiseProjectEntry[];
	configFiles: MiseProjectFlatConfigFile[];
	/** folders the user added via "Scan folder…", scanned recursively */
	scanDirectories?: string[];
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
