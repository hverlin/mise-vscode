import { describe, expect, it } from "bun:test";
import {
	deprecatedTeraFilters,
	deprecatedTeraTests,
	getTeraCompletionContext,
	getTeraHoverInformation,
	teraFilters,
	teraFunctions,
	teraTests,
	teraVariables,
} from "./teraKeywords";

const hover = (word: string, before: string, after = "") =>
	getTeraHoverInformation(word, before, after)?.value;

describe("getTeraCompletionContext", () => {
	it("finds filters after a pipe or a filter tag", () => {
		expect(getTeraCompletionContext("{{ env.HOME |")).toBe("filter");
		expect(getTeraCompletionContext("{{ env.HOME | low")).toBe("filter");
		expect(getTeraCompletionContext("{% filter ")).toBe("filter");
	});

	it("finds tests after is and is not", () => {
		expect(getTeraCompletionContext("{% if config_root is ")).toBe("test");
		expect(getTeraCompletionContext("{% if x is not def")).toBe("test");
	});

	it("finds attributes and expressions", () => {
		expect(getTeraCompletionContext("{{ env.")).toBe("attribute");
		expect(getTeraCompletionContext("{{ ")).toBe("expression");
		expect(getTeraCompletionContext("{{ read_")).toBe("expression");
		expect(getTeraCompletionContext("{{ x | default(value=")).toBe(
			"expression",
		);
		expect(getTeraCompletionContext("{% if this ")).toBe("expression");
	});

	it("completes expressions in a spread", () => {
		expect(getTeraCompletionContext("{{ [...")).toBe("expression");
		expect(getTeraCompletionContext("{{ [...it")).toBe("expression");
		expect(getTeraCompletionContext("{{ [...items, ...")).toBe("expression");
		expect(getTeraCompletionContext("{{ {...")).toBe("expression");
		expect(getTeraCompletionContext("{{ env.HO")).toBe("attribute");
	});

	it("finds the context of a long line quickly", () => {
		const start = performance.now();
		getTeraCompletionContext(`{{ ${"a".repeat(100_000)} `);
		expect(performance.now() - start).toBeLessThan(100);
	});

	it("completes nothing in a string literal", () => {
		expect(getTeraCompletionContext("{{ exec(command='ls | ")).toBe("string");
		expect(getTeraCompletionContext('{% if x == "this is ')).toBe("string");
		expect(
			getTeraCompletionContext("{{ read_json(path='p.json')['a'] | "),
		).toBe("filter");
		expect(getTeraCompletionContext("{{ 'a' }} {{ x | ")).toBe("filter");
	});
});

describe("getTeraHoverInformation", () => {
	it("tells a filter from a test of the same name", () => {
		expect(hover("float", "{{ x | ")).toBe("Converts to float");
		expect(hover("float", "{% if x is ")).toBe("The value is a float");
		expect(hover("map", "{% if x is not ")).toBe("The value is a map");
	});

	it("explains the Tera v1 filters and tests mise deprecates", () => {
		expect(hover("as_str", "{{ x | ")).toContain("use `str` instead");
		expect(hover("map", "{{ x | ")).toContain("deprecated");
		expect(hover("object", "{% if x is ")).toContain("use `map` instead");
	});

	it("explains functions and variables", () => {
		expect(hover("read_json", "{{ ", "(path='package.json') }}")).toContain(
			"Parses a JSON file",
		);
		expect(hover("system_brew_prefix", "{{ ", " }}")).toContain(
			"/opt/homebrew",
		);
		expect(hover("mise_config_dir", "{{ ", " }}")).toContain("MISE_CONFIG_DIR");
		expect(hover("env", "{{ ", ".HOME }}")).toContain("environment");
		expect(hover("HOME", "{{ env.", " }}")).toBeUndefined();
		expect(hover("unknown", "{{ x | ")).toBeUndefined();
		expect(hover("lower", "{{ exec(command='ls | ")).toBeUndefined();
		expect(hover("slug", "{{ x | ")).toContain("slug");
		expect(hover("range", "{{ [...", "(end=3)] }}")).toContain("range");
		expect(hover("constructor", "{{ x | ")).toBeUndefined();
		expect(hover("toString", "{% if x is ")).toBeUndefined();
		expect(hover("__proto__", "{{ x | ")).toBeUndefined();
	});
});

describe("Tera keywords", () => {
	it("suggests nothing deprecated", () => {
		for (const filter of teraFilters) {
			expect(Object.keys(deprecatedTeraFilters)).not.toContain(filter.name);
		}
		for (const test of teraTests) {
			expect(Object.keys(deprecatedTeraTests)).not.toContain(test.name);
		}
	});

	it("names every argument it inserts, as Tera 2 requires", () => {
		const entries = [...teraFunctions, ...teraFilters, ...teraTests];
		for (const { name, insertText } of entries) {
			const args = insertText?.match(/^\w+\((.*)\)$/)?.[1];
			for (const arg of args ? args.split(", ") : []) {
				expect(`${name}: ${arg}`).toMatch(/^\w+: \w+=\$\d$/);
			}
		}
	});

	it("has no duplicate names in a list", () => {
		for (const list of [teraVariables, teraFunctions, teraFilters, teraTests]) {
			const names = list.map((entry) => entry.name);
			expect(new Set(names).size).toBe(names.length);
		}
	});
});
