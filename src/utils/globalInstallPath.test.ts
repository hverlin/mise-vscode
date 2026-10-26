import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	getGlobalInstallPath,
	getInstallsDir,
	rebasePath,
} from "./globalInstallPath";

describe("getGlobalInstallPath", () => {
	let installsDir: string;
	let javaDir: string;
	let java21: string;
	let java22: string;
	const globalLink = () => path.join(javaDir, "global");
	const linkTo = (version: string) =>
		symlink(`./${version}`, globalLink(), "dir");
	/** java 21 is the active version, `globalInstall` the one global config selects */
	const resolve = (globalInstall?: string, installs = installsDir) =>
		getGlobalInstallPath(
			{ name: "java", install_path: java21 },
			globalInstall ? { java: [{ install_path: globalInstall }] } : {},
			installs,
		);

	beforeEach(async () => {
		installsDir = await mkdtemp(path.join(tmpdir(), "mise-global-"));
		javaDir = path.join(installsDir, "java");
		java21 = path.join(javaDir, "21.0.2");
		java22 = path.join(javaDir, "22.0.1");
		await mkdir(java21, { recursive: true });
		await mkdir(java22, { recursive: true });
	});

	afterEach(async () => {
		await rm(installsDir, { recursive: true, force: true });
	});

	it("is the global link when global config selects the version", async () => {
		await linkTo("21.0.2");

		expect(await resolve(java21)).toBe(globalLink());
	});

	it("is undefined when a project pins the version global config selects", async () => {
		await linkTo("21.0.2");

		// `mise ls --global` leaves out a tool project config overrides
		expect(await resolve()).toBeUndefined();
	});

	it("is undefined when global config selects another install", async () => {
		await linkTo("22.0.1");

		expect(await resolve(java22)).toBeUndefined();
	});

	it("is undefined when the link names another version", async () => {
		await linkTo("22.0.1");

		expect(await resolve(java21)).toBeUndefined();
	});

	it("is undefined without a link (mise older than 2026.10.8)", async () => {
		expect(await resolve(java21)).toBeUndefined();
	});

	it("is undefined for a file holding the target path", async () => {
		// the aliases older mise versions wrote on Windows
		await writeFile(globalLink(), "./21.0.2");

		expect(await resolve(java21)).toBeUndefined();
	});

	it("is undefined in a shared install dir", async () => {
		await linkTo("21.0.2");

		// another user running mise there moves the link
		expect(
			await resolve(java21, path.join(installsDir, "other")),
		).toBeUndefined();
		expect(
			await getGlobalInstallPath(
				{ name: "java", install_path: java21 },
				{ java: [{ install_path: java21 }] },
				undefined,
			),
		).toBeUndefined();
	});

	it("compares the real paths", async () => {
		const realpath = async (filePath: string) =>
			filePath === path.join("/installs/java/global")
				? path.join("/real/installs/java/21.0.2")
				: filePath.replace(/^[\\/]installs/, "/real/installs");

		expect(
			await getGlobalInstallPath(
				{ name: "java", install_path: path.join("/installs/java/21.0.2") },
				{ java: [{ install_path: path.join("/installs/java/21.0.2") }] },
				path.join("/installs"),
				realpath,
			),
		).toBe(path.join("/installs/java/global"));
	});
});

describe("getInstallsDir", () => {
	const previous = process.env.MISE_INSTALLS_DIR;
	afterEach(() => {
		if (previous === undefined) {
			delete process.env.MISE_INSTALLS_DIR;
		} else {
			process.env.MISE_INSTALLS_DIR = previous;
		}
	});

	it("is the installs folder of the data dir", () => {
		delete process.env.MISE_INSTALLS_DIR;

		expect(
			getInstallsDir({ dirs: { data: "/data", shims: "/data/shims" } }),
		).toBe(path.join("/data", "installs"));
		expect(getInstallsDir({} as MiseConfig)).toBeUndefined();
	});

	it("is MISE_INSTALLS_DIR when set", () => {
		process.env.MISE_INSTALLS_DIR = "/elsewhere";

		expect(
			getInstallsDir({ dirs: { data: "/data", shims: "/data/shims" } }),
		).toBe("/elsewhere");
	});
});

describe("rebasePath", () => {
	it("moves a path inside the folder", () => {
		expect(
			rebasePath("/installs/go/1.22.0/bin/go", "/installs/go/1.22.0", "/g"),
		).toBe(path.join("/g", "bin", "go"));
	});

	it("moves the folder itself", () => {
		expect(rebasePath("/installs/go/1.22.0", "/installs/go/1.22.0", "/g")).toBe(
			path.join("/g"),
		);
	});

	it("is undefined for a path outside the folder", () => {
		expect(
			rebasePath("/installs/go/1.22.0-rc/bin/go", "/installs/go/1.22.0", "/g"),
		).toBeUndefined();
		expect(
			rebasePath("/shims/go", "/installs/go/1.22.0", "/g"),
		).toBeUndefined();
	});
});
