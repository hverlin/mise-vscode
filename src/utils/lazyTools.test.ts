import { describe, expect, it } from "bun:test";
import { parse } from "toml-v1";
import {
	findToolDeclaration,
	getMissingTools,
	isLazyToolDeclaration,
	normalizeToolKey,
} from "./lazyTools";

// the `[tools]` declarations mise accepts for `lazy`
const { tools } = parse(`
[tools]
ripgrep = { version = "14.1.1", lazy = true }
fd = [{ version = "10.2.0", lazy = true }, "9.0.0"]
node = "24"
bat = { version = "0.25", lazy = false }

[tools.jq]
version = "1.7.1"
lazy = true
`) as { tools: Record<string, unknown> };

describe("isLazyToolDeclaration", () => {
	it("is true for a table declaring lazy", () => {
		expect(isLazyToolDeclaration(tools.ripgrep, "14.1.1")).toBe(true);
		expect(isLazyToolDeclaration(tools.jq, "1.7.1")).toBe(true);
	});

	it("is only true for the lazy versions of a list", () => {
		expect(isLazyToolDeclaration(tools.fd, "10.2.0")).toBe(true);
		expect(isLazyToolDeclaration(tools.fd, "9.0.0")).toBe(false);
	});

	it("matches a templated lazy version, which mise reports rendered", () => {
		const fd = [{ version: "{{ env.FD_VERSION }}", lazy: true }, "8.0.0"];
		expect(isLazyToolDeclaration(fd, "7.0.1")).toBe(true);
		expect(isLazyToolDeclaration(fd, "8.0.0")).toBe(false);
	});

	it("is false for the other declarations", () => {
		expect(isLazyToolDeclaration(tools.node, "24")).toBe(false);
		expect(isLazyToolDeclaration(tools.bat, "0.25")).toBe(false);
		expect(isLazyToolDeclaration(undefined, "1")).toBe(false);
	});
});

describe("getMissingTools", () => {
	const tool = (overrides: Partial<MiseTool>): MiseTool => ({
		name: "node",
		version: "24.0.0",
		requested_version: "24",
		installed: true,
		active: true,
		install_path: "/mise/installs/node/24.0.0",
		...overrides,
	});

	it("leaves out the tools installed on first use", () => {
		const missing = tool({ name: "node", installed: false });
		expect(
			getMissingTools([
				tool({ name: "go" }),
				missing,
				tool({ name: "ripgrep", installed: false, lazy: true }),
			]),
		).toEqual([missing]);
	});
});

describe("findToolDeclaration", () => {
	const configTools = {
		nodejs: { version: "24", lazy: true },
		"core:python": "3.13",
		"github:BurntSushi/ripgrep[bin=rg]": { version: "14", lazy: true },
		go: "1.24",
	};

	it("finds the key as written", () => {
		expect(findToolDeclaration(configTools, "go")).toBe("1.24");
	});

	it("finds the keys mise reports under another name", () => {
		expect(findToolDeclaration(configTools, "node")).toEqual({
			version: "24",
			lazy: true,
		});
		expect(findToolDeclaration(configTools, "python")).toBe("3.13");
		expect(
			findToolDeclaration(configTools, "github:BurntSushi/ripgrep"),
		).toEqual({ version: "14", lazy: true });
		expect(findToolDeclaration(configTools, "deno")).toBeUndefined();
	});
});

describe("normalizeToolKey", () => {
	it("keeps the names mise does not rewrite", () => {
		expect(normalizeToolKey("npm:nodejs-tool")).toBe("npm:nodejs-tool");
		expect(normalizeToolKey("aqua:BurntSushi/ripgrep")).toBe(
			"aqua:BurntSushi/ripgrep",
		);
	});
});
