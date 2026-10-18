import { describe, expect, it } from "bun:test";
import {
	getPackageRegistryQuery,
	hasToolVersion,
	parseToolSearchResults,
} from "./toolSearch";

describe("getPackageRegistryQuery", () => {
	it("searches a package registry once something follows its prefix", () => {
		expect(getPackageRegistryQuery("npm:prettier")).toBe("npm:prettier");
		expect(getPackageRegistryQuery(" cargo:rip ")).toBe("cargo:rip");
		expect(getPackageRegistryQuery("gem:rails")).toBe("gem:rails");
		expect(getPackageRegistryQuery("dotnet:csharpier")).toBe(
			"dotnet:csharpier",
		);
		expect(getPackageRegistryQuery("npm:@prettier/plugin-xml")).toBe(
			"npm:@prettier/plugin-xml",
		);
	});

	it("leaves the other values to the registry list", () => {
		expect(getPackageRegistryQuery("npm:")).toBeUndefined();
		expect(getPackageRegistryQuery("node")).toBeUndefined();
		expect(getPackageRegistryQuery("aqua:jqlang/jq")).toBeUndefined();
		expect(getPackageRegistryQuery("pnpm:foo")).toBeUndefined();
		expect(getPackageRegistryQuery("")).toBeUndefined();
	});
});

describe("parseToolSearchResults", () => {
	it("reads the tool and its description from each line", () => {
		expect(
			parseToolSearchResults(
				[
					"npm:prettier                     Prettier is an opinionated code formatter",
					"npm:@prettier/sync               Synchronous version of Prettier",
					"npm:no-description",
					"",
				].join("\n"),
			),
		).toEqual([
			{
				name: "npm:prettier",
				description: "Prettier is an opinionated code formatter",
			},
			{
				name: "npm:@prettier/sync",
				description: "Synchronous version of Prettier",
			},
			{ name: "npm:no-description", description: "" },
		]);
	});

	it("is empty without results", () => {
		expect(parseToolSearchResults("")).toEqual([]);
	});
});

describe("hasToolVersion", () => {
	it("is true for a tool ending with a version", () => {
		expect(hasToolVersion("node@20")).toBe(true);
		expect(hasToolVersion("node@latest")).toBe(true);
		expect(hasToolVersion("npm:prettier@3")).toBe(true);
		expect(hasToolVersion("npm:@prettier/plugin-xml@1.2.0")).toBe(true);
		expect(hasToolVersion("github:cli/cli@latest")).toBe(true);
	});

	it("is false without one, an npm scope is not one", () => {
		expect(hasToolVersion("node")).toBe(false);
		expect(hasToolVersion("node@")).toBe(false);
		expect(hasToolVersion("npm:@prettier/plugin-xml")).toBe(false);
		expect(hasToolVersion("")).toBe(false);
	});
});
