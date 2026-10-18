import { describe, expect, it } from "bun:test";
import { parse } from "toml-v1";
import { getMissingTools, isLazyToolDeclaration } from "./lazyTools";

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
