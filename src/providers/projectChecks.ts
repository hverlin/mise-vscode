import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import { getCachedTomlParser } from "../utils/miseFileParser";
import { getMiseErrorReason } from "../utils/miseUtilts";
import {
	findProjectCheckPosition,
	formatProjectCheckDetail,
	formatProjectChecksSummary,
	isFailedProjectCheck,
	PROJECT_CHECK_ICONS,
	sortProjectChecks,
} from "../utils/projectChecks";

const PROJECT_CHECKS_DOCS =
	"https://mise.jdx.dev/configuration/project-diagnostics.html";

/** Opens the config file of a check at its `[doctor.checks.<name>]` */
async function openProjectCheck(check: MiseProjectCheck) {
	let document: vscode.TextDocument;
	try {
		document = await vscode.workspace.openTextDocument(
			vscode.Uri.file(check.source),
		);
	} catch (error) {
		logger.info(`Could not open ${check.source}:`, error as Error);
		vscode.window.showErrorMessage(`Cannot open ${check.source}`);
		return;
	}
	const parser = getCachedTomlParser(document);
	const position = parser
		? findProjectCheckPosition(parser.getAllPositions(), check.name)
		: undefined;
	const selection = position
		? new vscode.Range(
				position.line,
				position.character,
				position.line,
				position.character,
			)
		: undefined;
	await vscode.window.showTextDocument(document, { selection });
}

/**
 * Runs the `[doctor.checks.<name>]` of the project (`mise doctor project`) and
 * lists the ones that did not pass. Picking one opens its declaration.
 */
export async function runProjectChecks(miseService: MiseService) {
	if (!(await miseService.supportsProjectChecks())) {
		vscode.window.showErrorMessage(
			"Running the project checks requires mise 2026.9.6 or later. Update mise with `mise self-update`.",
		);
		return;
	}

	let report: MiseProjectChecksReport;
	try {
		report = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "mise: running the project checks",
			},
			() => miseService.runProjectChecks(),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.info("Could not run the project checks:", error as Error);
		vscode.window.showErrorMessage(
			`Cannot run the project checks: ${getMiseErrorReason(message) ?? message}`,
		);
		return;
	}

	if (report.errors.length) {
		vscode.window.showErrorMessage(
			`Cannot run the project checks: ${report.errors.join("; ")}`,
		);
		if (!report.checks.length) {
			return;
		}
	}

	if (!report.checks.length) {
		const learnMore = "Learn more";
		const selection = await vscode.window.showInformationMessage(
			"This project declares no checks. Add them to mise.toml with [doctor.checks.<name>].",
			learnMore,
		);
		if (selection === learnMore) {
			await vscode.env.openExternal(vscode.Uri.parse(PROJECT_CHECKS_DOCS));
		}
		return;
	}

	const summary = formatProjectChecksSummary(report.checks);
	if (!report.checks.some(isFailedProjectCheck)) {
		vscode.window.showInformationMessage(`Project checks: ${summary}.`);
		return;
	}

	const picked = await vscode.window.showQuickPick(
		sortProjectChecks(report.checks).map((check) => ({
			label: `$(${PROJECT_CHECK_ICONS[check.status]}) ${check.name}`,
			description: check.description ?? undefined,
			detail: formatProjectCheckDetail(check) || undefined,
			check,
		})),
		{
			title: `Project checks: ${summary}`,
			placeHolder: "Select a check to open its declaration",
			matchOnDescription: true,
			matchOnDetail: true,
		},
	);
	if (picked) {
		await openProjectCheck(picked.check);
	}
}
