// @ts-ignore
import { describe, expect, test } from "bun:test";
import { SUPPORTED_EXTENSIONS } from "./utils/supportedExtensions";

import packageJson from "../package.json";

describe("package.json configuration tests", () => {
	test("ignore list should be correct", () => {
		const supportedExtensionNames = SUPPORTED_EXTENSIONS.map(
			(extension) => extension.extensionName,
		);

		const ignoreListOptions =
			packageJson.contributes.configuration.properties[
				"mise.configureExtensionsAutomaticallyIgnoreList"
			].items.enum;

		expect(ignoreListOptions).toEqual(supportedExtensionNames);
	});
});
