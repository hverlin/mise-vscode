import type * as vscode from "vscode";
import { MiseExtension } from "./miseExtension";
import { logger } from "./utils/logger";

const miseExtension = new MiseExtension();

export async function activate(context: vscode.ExtensionContext) {
	try {
		await miseExtension.activate(context);
	} catch (error) {
		logger.error("Error while activating Mise extension", error);
		miseExtension.setErrorState((error as Error).message);
		throw error;
	}
}
