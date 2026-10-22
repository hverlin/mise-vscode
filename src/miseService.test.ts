import { describe, expect, it, spyOn } from "bun:test";
import type * as vscode from "vscode";
import { MiseService } from "./miseService";

/** a service whose `mise ls-remote` prints `stdout` */
function createService(stdout: string) {
	const service = new MiseService({} as vscode.ExtensionContext);
	spyOn(service, "getMiseBinaryPath").mockReturnValue("/usr/bin/mise");
	Object.assign(service, {
		longTTLCache: { execCmd: async () => ({ stdout, stderr: "" }) },
	});
	return service;
}

describe("listRemoteVersions", () => {
	it("lists the versions newest first", async () => {
		const versions = await createService(
			"2.0.0\n2.1.0\n2.2.0\n",
		).listRemoteVersions("deno");
		expect(versions).toEqual(["2.2.0", "2.1.0", "2.0.0"]);
	});

	it("lists no version when mise prints none", async () => {
		expect(await createService("").listRemoteVersions("deno")).toEqual([]);
		expect(await createService("\n").listRemoteVersions("deno")).toEqual([]);
	});
});
