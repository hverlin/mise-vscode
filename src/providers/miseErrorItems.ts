// Tree items shown when a view could not load, shared by the tasks, tools and
// environment variable views.
//
// The welcome views these replace can only show fixed text, so a failure always
// read "Error loading tasks. Open logs" whatever went wrong. mise usually says
// more than that, and what to do about it depends on what it said.

import * as vscode from "vscode";
import { MISE_DOCTOR, MISE_OPEN_LOGS } from "../commands";
import { expandPath } from "../utils/fileUtils";
import { parseMiseError } from "../utils/miseUtilts";

/** Marker class so each view can widen its node union by one type */
export class MiseErrorItem extends vscode.TreeItem {}

function actionItem(
	label: string,
	icon: string,
	command: string,
	args: unknown[] = [],
): MiseErrorItem {
	const item = new MiseErrorItem(label, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon(icon);
	item.command = { command, title: label, arguments: args };
	return item;
}

/**
 * What to show in a view that failed to load: what mise said, then the actions
 * worth taking for that kind of failure.
 *
 * `mise doctor` is only offered when the cause is unknown. For a parse error it
 * reports the same error again, so it would send the user in a circle.
 */
export function buildMiseErrorItems(
	error: unknown,
	subject: string,
): MiseErrorItem[] {
	const parsed = parseMiseError(error);
	const full = error instanceof Error ? error.message : String(error);

	const item = new MiseErrorItem(
		`Could not load ${subject}`,
		vscode.TreeItemCollapsibleState.None,
	);
	item.iconPath = new vscode.ThemeIcon(
		"error",
		new vscode.ThemeColor("list.errorForeground"),
	);
	item.tooltip = full;

	// what mise said, when it said something worth repeating
	const where =
		parsed.line !== undefined
			? `line ${parsed.line}${parsed.column !== undefined ? `, column ${parsed.column}` : ""}`
			: undefined;
	item.description = [parsed.reason, where].filter(Boolean).join(" · ");

	// mise abbreviates the home directory in the snippet it draws, so the path
	// it reports is not one the editor can open as is
	const file = parsed.file ? expandPath(parsed.file) : undefined;
	if (file) {
		const at = new vscode.Position(
			Math.max((parsed.line ?? 1) - 1, 0),
			Math.max((parsed.column ?? 1) - 1, 0),
		);
		item.command = {
			command: "vscode.open",
			title: "Open config file",
			arguments: [
				vscode.Uri.file(file),
				{ selection: new vscode.Range(at, at) },
			],
		};
	}

	return [
		item,
		actionItem("Open logs", "output", MISE_OPEN_LOGS),
		actionItem("Run mise doctor", "stethoscope", MISE_DOCTOR),
	];
}
