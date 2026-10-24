import { describe, expect, it } from "bun:test";
import { isMiseManagedPath } from "./configureExtensionUtil";

describe("isMiseManagedPath", () => {
	const miseConfig = {
		dirs: { data: "/data/mise", shims: "/data/mise/shims" },
	};

	it("recognizes the paths the extension writes", () => {
		for (const value of [
			"/data/mise/installs/java/21.0.2",
			"/data/mise/installs/java/global",
			"/data/mise/installs/erlang/global/bin",
			"/data/mise/shims/go",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: expected
			"${workspaceFolder}/.vscode/mise-tools/java",
		]) {
			expect(isMiseManagedPath(value, miseConfig)).toBe(true);
		}
	});

	it("leaves the paths the user chose", () => {
		expect(isMiseManagedPath("/opt/jdk-21", miseConfig)).toBe(false);
		expect(isMiseManagedPath("", miseConfig)).toBe(false);
		expect(isMiseManagedPath(undefined, miseConfig)).toBe(false);
	});
});
