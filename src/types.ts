type depsArray = Array<string | string[]>;

type MiseTask = {
	name: string;
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
	latest: string;
	bump?: string;
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
	description: string;
	installed_versions: string[];
	requested_versions: string[];
	active_versions: string[];
	config_source: { type: string; path: string };
	tool_options: {
		os: string;
		install_env: Record<string, string>;
	};
};
