import { describe, expect, test } from "bun:test";
import { SUPPORTED_EXTENSIONS } from "./utils/supportedExtensions";

import packageJson from "../package.json";

describe("package.json configuration tests", () => {
	test("ignore list should be correct", () => {
		const supportedExtensionNames = [
			...new Set(
				SUPPORTED_EXTENSIONS.map((extension) => extension.extensionId),
			),
		];

		const ignoreListOptions =
			packageJson.contributes.configuration.properties[
				"mise.configureExtensionsAutomaticallyIgnoreList"
			].items.enum;

		expect(ignoreListOptions).toEqual(supportedExtensionNames);
	});
});
