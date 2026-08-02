import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
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

	// `getConfOrElse` only falls back when a key is absent from the manifest, so
	// a fallback that disagrees with the declared default is silently dead code
	// that would change behaviour the day the property is renamed or removed.
	test("every getConfOrElse fallback matches the declared default", () => {
		const source = readFileSync(
			path.join(import.meta.dir, "configuration.ts"),
			"utf8",
		);

		const fallbacks = [...findCalls(source, "getConfOrElse(")]
			.map((call) => splitTopLevelArgs(call))
			.filter((args) => args.length === 2)
			.map(([key, fallback]) => ({
				key: (key as string).replace("CONFIGURATION_FLAGS.", ""),
				fallback: JSON.parse(fallback as string),
			}));

		// guards against the parsing above silently matching nothing
		expect(fallbacks.length).toBeGreaterThan(20);

		const properties = packageJson.contributes.configuration
			.properties as Record<string, { default?: unknown }>;

		for (const { key, fallback } of fallbacks) {
			expect({ key, default: fallback }).toEqual({
				key,
				default: properties[`mise.${key}`]?.default,
			});
		}
	});
});

/** Bodies of every `name(...)` call in `source`, parentheses balanced */
function* findCalls(source: string, name: string): Generator<string> {
	let index = source.indexOf(name);
	while (index !== -1) {
		let depth = 1;
		let cursor = index + name.length;
		while (cursor < source.length && depth > 0) {
			if (source[cursor] === "(") {
				depth++;
			} else if (source[cursor] === ")") {
				depth--;
			}
			cursor++;
		}
		yield source.slice(index + name.length, cursor - 1);
		index = source.indexOf(name, cursor);
	}
}

/** Arguments of a call body, split on the commas that are not nested */
function splitTopLevelArgs(body: string): unknown[] {
	const args: string[] = [];
	let depth = 0;
	let current = "";
	for (const char of body) {
		if (char === "," && depth === 0) {
			args.push(current);
			current = "";
			continue;
		}
		if (char === "(" || char === "[" || char === "{") {
			depth++;
		}
		if (char === ")" || char === "]" || char === "}") {
			depth--;
		}
		current += char;
	}
	args.push(current);
	return args
		.map((arg) => arg.trim())
		.filter(Boolean)
		.map((arg) => arg.replace(/,\s*(?=[\]}])/g, ""));
}
