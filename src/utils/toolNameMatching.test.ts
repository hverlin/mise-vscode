import { describe, expect, test } from "bun:test";
import { expandToolNames } from "./toolNameMatching";

const registry = [
	{
		short: "shfmt",
		backends: [
			"aqua:mvdan/sh",
			"asdf:luizm/asdf-shfmt",
			"go:mvdan.cc/sh/v3/cmd/shfmt",
		],
	},
	{ short: "node", backends: ["core:node"] },
	{
		short: "1password",
		backends: ["vfox:mise-plugins/vfox-1password", "aqua:1password/cli"],
	},
	{
		short: "1password-cli",
		backends: ["vfox:mise-plugins/vfox-1password", "aqua:1password/cli"],
	},
];

describe("expandToolNames", () => {
	test("a short name expands to all its registry backends", () => {
		const names = expandToolNames("shfmt", registry);
		expect(names).toEqual(
			new Set([
				"shfmt",
				"aqua:mvdan/sh",
				"asdf:luizm/asdf-shfmt",
				"go:mvdan.cc/sh/v3/cmd/shfmt",
			]),
		);
	});

	test("a backend source expands to the short names using it", () => {
		const names = expandToolNames("aqua:mvdan/sh", registry);
		expect(names).toEqual(new Set(["aqua:mvdan/sh", "shfmt"]));
	});

	test("a backend shared by several short names expands to all of them", () => {
		const names = expandToolNames("aqua:1password/cli", registry);
		expect(names).toEqual(
			new Set(["aqua:1password/cli", "1password", "1password-cli"]),
		);
	});

	test("a name unknown to the registry only matches itself", () => {
		expect(expandToolNames("github:acme/tool", registry)).toEqual(
			new Set(["github:acme/tool"]),
		);
	});
});
