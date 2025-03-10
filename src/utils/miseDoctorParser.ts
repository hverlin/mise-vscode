import { expandPath } from "./fileUtils";

function expandConfig(cfg: MiseConfig): MiseConfig {
	for (const [key, value] of Object.entries(cfg.dirs)) {
		if (!value) {
			continue;
		}
		cfg.dirs[key] = expandPath(value);
	}
	return cfg;
}

export { expandConfig };
