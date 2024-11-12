type MiseTask = {
	name: string;
	source: string;
	description: string;
};

type MiseTool = {
	name: string;
	version: string;
	requested_version: string;
	installed: boolean;
	active: boolean;
	install_path: string;
};

type MiseEnv = {
	name: string;
	value: string;
};
