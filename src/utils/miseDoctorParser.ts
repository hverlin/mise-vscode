import { expandPath } from "./fileUtils";

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
	problems?: {
		newMiseVersionAvailable?: {
			currentVersion: string;
			latestVersion: string;
		};
	};
};

function parseMiseConfigRaw(content: string): MiseConfig {
	const result: MiseConfig = { dirs: { shims: "" }, problems: {} };
	const lines: string[] = content.split("\n");

	let currentSection: string | null = null;
	let sectionIndentLevel = 0;

	// example: new mise version 2024.11.19 available, currently on 2024.11.18
	const match = content.match(
		/new mise version (\d+\.\d+\.\d+) available, currently on (\d+\.\d+\.\d+)/,
	);
	if (match) {
		const [, latestVersion, currentVersion] = match;
		if (currentVersion !== undefined && latestVersion !== undefined) {
			result.problems ||= {};
			result.problems.newMiseVersionAvailable = {
				currentVersion,
				latestVersion,
			};
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) {
			continue;
		}

		const trimmedLine = line.trim();

		if (trimmedLine === "dirs:") {
			currentSection = "dirs";
			sectionIndentLevel = line.length - line.trimStart().length;
			continue;
		}

		if (currentSection === "dirs" && trimmedLine.length > 0) {
			const lineIndentLevel = line.length - line.trimStart().length;

			if (lineIndentLevel <= sectionIndentLevel) {
				if (trimmedLine !== "dirs:") {
					currentSection = null;
					continue;
				}
			}

			const match = trimmedLine.match(/^(\w+):\s+(.+)$/);
			if (match) {
				const [, key, value] = match;
				if (key === undefined) {
					continue;
				}
				result.dirs[key] = value;
			}
		}

		if (currentSection === "dirs" && trimmedLine === "") {
			currentSection = null;
		}
	}
	return result;
}

function parseMiseConfig(content: string): MiseConfig {
	const cfg = parseMiseConfigRaw(content);
	for (const [key, value] of Object.entries(cfg.dirs)) {
		if (!value) {
			continue;
		}
		cfg.dirs[key] = expandPath(value);
	}
	return cfg;
}

export { parseMiseConfig, parseMiseConfigRaw };
export type { MiseConfig, MiseDirs };
