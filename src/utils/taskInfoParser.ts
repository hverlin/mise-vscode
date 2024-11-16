export interface MiseTaskInfo {
	name: string;
	description?: string;
	source: string;
	run: string;
	usageSpec: TaskUsageSpec;
}

export interface TaskUsageSpec {
	name: string;
	bin: string;
	flags: TaskFlag[];
	args: TaskArg[];
}

export interface TaskFlag {
	name: string;
	arg?: string; // For flags that take values (options)
}

export interface TaskArg {
	name: string;
	required: boolean;
}

/**
 * Parse a single line of the usage spec section
 */
export function parseUsageSpecLine(line: string, spec: TaskUsageSpec): void {
	const tokens = line.trim().split(/\s+/);

	if (!tokens[0]) return; // Handle empty lines

	if (line.startsWith("name")) {
		spec.name = tokens[1]?.replace(/"/g, "") || "";
	} else if (line.startsWith("bin")) {
		spec.bin = tokens[1]?.replace(/"/g, "") || "";
	} else if (line.startsWith("flag")) {
		const flagName = tokens[1]?.replace(/"/g, "");
		if (!flagName) return; // Skip if no flag name is provided

		const flag: TaskFlag = {
			name: flagName,
		};

		// Check for argument definition
		if (line.includes("{")) {
			// Multiline or single-line argument
			const argMatch = line.match(/\[([^\]]+)\]/);
			if (argMatch) {
				flag.arg = argMatch[1];
			}
		}

		spec.flags.push(flag);
	} else if (line.startsWith("arg")) {
		const argMatch = line.match(/<([^>]+)>/);
		if (argMatch) {
			spec.args.push({
				name: argMatch[1] || "",
				required: true,
			});
		}
	} else if (line.startsWith("  arg")) {
		// Handle indented argument definition for flag
		const argMatch = line.match(/\[([^\]]+)\]/);
		if (argMatch && spec.flags.length > 0) {
			const taskFlag = spec.flags[spec.flags.length - 1];
			if (!taskFlag) {
				return;
			}
			taskFlag.arg = argMatch[1];
		}
	}
}

export function parseTaskInfo(output: string): MiseTaskInfo {
	const lines = output.split("\n");
	let currentSection = "";
	let collectingRun = false;
	const info: Partial<MiseTaskInfo> = {
		usageSpec: { name: "", bin: "", flags: [], args: [] },
	};

	const runLines: string[] = [];
	let currentFlag: TaskFlag | null = null;

	for (let i = 0; i < lines.length; i++) {
		const currentLine = lines[i];
		if (!currentLine) {
			continue;
		}
		const trimmedLine = currentLine.trim();

		if (trimmedLine.startsWith("Task:")) {
			info.name = trimmedLine.replace("Task:", "").trim();
		} else if (trimmedLine.startsWith("Description:")) {
			info.description = trimmedLine.replace("Description:", "").trim();
		} else if (trimmedLine.startsWith("Source:")) {
			info.source = trimmedLine.replace("Source:", "").trim();
		} else if (trimmedLine.startsWith("Run:")) {
			collectingRun = true;
		} else if (trimmedLine === "Usage Spec:") {
			collectingRun = false;
			info.run = runLines.join("\n").trim();
			currentSection = "usageSpec";
		} else if (collectingRun) {
			runLines.push(trimmedLine);
		} else if (currentSection === "usageSpec") {
			if (
				trimmedLine.startsWith("flag") &&
				trimmedLine.includes("{") &&
				!trimmedLine.includes("arg")
			) {
				// Start of a multiline flag definition
				const tokens = trimmedLine.trim().split(/\s+/);
				const flagName = tokens[1]?.replace(/"/g, "");
				if (flagName) {
					currentFlag = { name: flagName };
					if (!info.usageSpec) {
						info.usageSpec = { name: "", bin: "", flags: [], args: [] };
					}
					info.usageSpec.flags.push(currentFlag);
				}
			} else if (currentFlag && trimmedLine.trim().startsWith("arg")) {
				// Indented argument line in multiline flag definition
				const argMatch = trimmedLine.match(/\[([^\]]+)\]/);
				if (argMatch) {
					currentFlag.arg = argMatch[1];
				}
				if (!trimmedLine.endsWith("{")) {
					currentFlag = null;
				}
			} else {
				currentFlag = null;
				parseUsageSpecLine(trimmedLine, info.usageSpec as TaskUsageSpec);
			}
		}
	}

	// Handle case where Usage Spec: never appears after Run:
	if (collectingRun && !info.run) {
		info.run = runLines.join("\n").trim();
	}

	return info as MiseTaskInfo;
}
