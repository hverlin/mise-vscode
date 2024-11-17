import * as toml from "@iarna/toml";
import vscode from "vscode";
import { logger } from "./logger";

export function findTaskPosition(
	document: vscode.TextDocument,
	taskName: string,
): vscode.Position | undefined {
	const text = document.getText();

	try {
		const parsed = toml.parse(text);
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
