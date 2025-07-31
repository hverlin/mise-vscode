import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";
import { SUPPORTED_EXTENSIONS } from "./utils/supportedExtensions";

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

	test("include list should be correct", () => {
		const supportedExtensionNames = [
			...new Set(
				SUPPORTED_EXTENSIONS.map((extension) => extension.extensionId),
			),
		];

		const includeListOptions =
			packageJson.contributes.configuration.properties[
				"mise.configureExtensionsAutomaticallyIncludeList"
			].items.enum;

		expect(includeListOptions).toEqual(["all"].concat(supportedExtensionNames));
	});
});
