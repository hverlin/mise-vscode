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
};

function parseMiseConfig(content: string): MiseConfig {
	const result: MiseConfig = { dirs: { shims: "" } };
	const lines: string[] = content.split("\n");

	let currentSection: string | null = null;
	let sectionIndentLevel = 0;

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

	for (const [key, value] of Object.entries(result.dirs)) {
		if (!value) {
			continue;
		}

		result.dirs[key] = expandPath(value);
	}

	return result;
}

export { parseMiseConfig };
export type { MiseConfig, MiseDirs };
