type MiseTask = {
	name: string;
	source: string;
	description: string;
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
