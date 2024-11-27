import { SourceTracker, parse } from "toml-v1";
import * as vscode from "vscode";
import { logger } from "./logger";

type MiseTomlType = {
	tools?: Record<string, string | object>;
	env?: Record<string, string>;
};

class TomlParser<T> {
	sourceTracker: SourceTracker;
	public parsed: T;

	constructor(private readonly source: string) {
		this.source = source;
		this.sourceTracker = new SourceTracker();
		this.parsed = parse(source, "", this.sourceTracker);
	}

	findRange(obj: object, needle: string) {
		let keySource: { start: number; end: number };
		try {
			keySource = this.sourceTracker.getKeySource(obj, needle);
		} catch (e) {
			return undefined;
		}

		let line = 0;
		let lastNewLine = -1;

		for (let i = 0; i < keySource.end; i++) {
			if (this.source[i] === "\n") {
				line++;
				lastNewLine = i;
			}
		}

		let startLine = 0;
		let startChar = keySource.start;
		for (let i = 0; i < keySource.start; i++) {
			if (this.source[i] === "\n") {
				startLine++;
				startChar = keySource.start - (i + 1);
			}
		}

		return new vscode.Range(
			new vscode.Position(startLine, startChar),
			new vscode.Position(line, keySource.end - (lastNewLine + 1)),
		);
	}
}

const toolsMapping = [
	["node", "nodejs"] as const,
	["go", "golang"] as const,
] as const;

export function findToolPosition(
	document: vscode.TextDocument,
	toolName: string,
) {
	const toolsToTry: string[] = [];
	toolsToTry.push(toolName);
	for (const [from, to] of toolsMapping) {
		if (toolName === from) {
			toolsToTry.push(to);
		}
		if (toolName === to) {
			toolsToTry.push(from);
		}
	}

	const tomParser = new TomlParser<MiseTomlType>(document.getText());
	for (const tool of toolsToTry) {
		const range = tomParser.findRange(tomParser.parsed.tools ?? {}, tool);
		if (range) {
			return range;
		}
	}
}

export function findEnvVarPosition(
	documents: vscode.TextDocument[],
	envVarName: string,
) {
	for (const document of documents) {
		const parser = new TomlParser<MiseTomlType>(document.getText());
		const range = parser.findRange(parser.parsed.env ?? {}, envVarName);
		if (range) {
			return { document, range };
		}
	}
	return undefined;
}

export function findTaskPosition(
	document: vscode.TextDocument,
	taskName: string,
): vscode.Position | undefined {
	const text = document.getText();

	try {
		const parsed = parse(text);
		const lines = text.split("\n");

		if (parsed.tasks) {
			const sectionPattern = new RegExp(
				`\\[tasks\\.${taskName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`,
			);

			const inlinePattern = new RegExp(
				`^\\s*${taskName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`,
			);

			let inTasksSection = false;

			for (let i = 0; i < lines.length; i++) {
				const currentLine = lines[i];
				if (currentLine === undefined) {
					continue;
				}

				const trimmedLine = currentLine.trim();
				if (
					sectionPattern.test(trimmedLine) ||
					trimmedLine.startsWith(`[tasks."${taskName}"`) ||
					trimmedLine.startsWith(`tasks.${taskName}`) ||
					trimmedLine.startsWith(`tasks."${taskName}"`)
				) {
					return new vscode.Position(i, currentLine.indexOf(taskName));
				}

				if (trimmedLine === "[tasks]") {
					inTasksSection = true;
					continue;
				}

				if (inTasksSection && trimmedLine.startsWith("[")) {
					inTasksSection = false;
				}

				if (inTasksSection && inlinePattern.test(trimmedLine)) {
					return new vscode.Position(i, currentLine.indexOf(taskName));
				}
			}
		} else {
			for (let i = 0; i < lines.length; i++) {
				const currentLine = lines[i];
				if (currentLine === undefined) {
					continue;
				}

				const trimmedLine = currentLine.trim();
				if (
					trimmedLine.startsWith(`[${taskName}]`) ||
					trimmedLine.startsWith(`["${taskName}"]`) ||
					trimmedLine.startsWith(`${taskName} =`) ||
					trimmedLine.startsWith(`"${taskName}"`)
				) {
					return new vscode.Position(i, currentLine.indexOf(taskName));
				}
			}
		}
	} catch (error) {
		logger.error("Error parsing TOML:", error as Error);
	}

	return undefined;
}
