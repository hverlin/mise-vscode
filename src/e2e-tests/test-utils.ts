import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type * as sinon from "sinon";
import * as vscode from "vscode";
import {
	compareVersions,
	type MiseVersionTuple,
	parseMiseVersion,
} from "../utils/miseUtilts";

/**
 * Whether the mise the tests run is at least this version. CI installs a mise
 * release once it is a day old (`minimum_release_age` of mise-action), so the
 * tests of a feature of the latest release skip until then.
 */
export async function isMiseAtLeast(
	miseBinaryPath: string,
	version: MiseVersionTuple,
): Promise<boolean> {
	const env = { ...process.env };
	// an older mise rejects a list of paranoid categories
	delete env.MISE_PARANOID;
	const { stdout } = await promisify(execFile)(miseBinaryPath, ["--version"], {
		env,
	});
	const current = parseMiseVersion(stdout);
	return current !== undefined && compareVersions(current, version) >= 0;
}

type QuickPickItem = string | vscode.QuickPickItem;

export function stubShowQuickPick(
	sandbox: sinon.SinonSandbox,
	predicate: (item: QuickPickItem) => boolean,
): () => string | undefined {
	let selectedItemLabel: string | undefined;
	const stub = sandbox.stub(vscode.window, "showQuickPick");

	stub.callsFake(
		async <T extends QuickPickItem>(
			items: readonly T[] | Thenable<readonly T[]>,
		): Promise<T | undefined> => {
			let resolvedItems = items;
			if (!Array.isArray(items)) {
				resolvedItems = await items;
			}

			if (!(Array.isArray(resolvedItems) && resolvedItems.length > 0)) {
				return undefined;
			}

			const selectedItem = resolvedItems.find((item) => predicate(item));
			if (!selectedItem) {
				console.log(
					`No item matching predicate found in ${resolvedItems.length} items`,
				);
				return undefined;
			}

			selectedItemLabel = getItemLabel(selectedItem);
			console.log(`Selected item: ${selectedItemLabel}`);
			return selectedItem;
		},
	);

	return () => selectedItemLabel;
}

export function stubShowQuickPickWithText(
	sandbox: sinon.SinonSandbox,
	searchText: string,
): () => string | undefined {
	return stubShowQuickPick(sandbox, (item) => {
		const itemStr = getItemLabel(item);
		return itemStr.includes(searchText);
	});
}

function getItemLabel(item: QuickPickItem): string {
	if (typeof item === "string") {
		return item;
	}
	if (typeof item === "object" && item !== null) {
		return item.label || JSON.stringify(item);
	}
	return String(item);
}
