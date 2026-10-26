import { describe, expect, it } from "bun:test";
import path from "node:path";
import type { MiseService } from "../miseService";
import {
	createCustomFolderExtensionConfig,
	SUPPORTED_EXTENSIONS,
} from "./supportedExtensions";

const miseConfig = { dirs: { data: "/data", shims: "/data/shims" } };

const extension = (extensionId: string) => {
	const found = SUPPORTED_EXTENSIONS.find(
		(ext) => ext.extensionId === extensionId,
	);
	if (!found) {
		throw new Error(`${extensionId} is not supported`);
	}
	return found;
};

/** what `getStableInstallPath` answers for the tool, and the symlinks made */
function fakeMiseService({
	stableInstallPath,
	which = {},
}: {
	stableInstallPath: string;
	which?: Record<string, string>;
}) {
	const symlinks: Array<[string, string]> = [];
	const miseService = {
		getStableInstallPath: async () => stableInstallPath,
		which: async (name: string) => which[name],
		createMiseToolSymlink: async (name: string, target: string) => {
			symlinks.push([name, target]);
			return `\${workspaceFolder}/.vscode/mise-tools/${name}`;
		},
	} as unknown as MiseService;
	return { miseService, symlinks };
}

describe("SDK folder settings", () => {
	const java = {
		name: "java",
		version: "21.0.2",
		requested_version: "21",
		installed: true,
		active: true,
		install_path: "/data/installs/java/21.0.2",
	};

	it("write the global link of a version global config selects", async () => {
		const { miseService } = fakeMiseService({
			stableInstallPath: "/data/installs/java/global",
		});

		expect(
			await extension("redhat.java").generateConfiguration({
				tool: java,
				miseService,
				miseConfig,
				useShims: true,
				useSymLinks: false,
			}),
		).toEqual({ "java.jdt.ls.java.home": "/data/installs/java/global" });
	});

	it("keep the workspace symlink to the install when symlinks are on", async () => {
		const { miseService, symlinks } = fakeMiseService({
			stableInstallPath: "/data/installs/java/global",
		});

		expect(
			await extension("redhat.java").generateConfiguration({
				tool: java,
				miseService,
				miseConfig,
				useShims: true,
				useSymLinks: true,
			}),
		).toEqual({
			// biome-ignore lint/suspicious/noTemplateCurlyInString: expected
			"java.jdt.ls.java.home": "${workspaceFolder}/.vscode/mise-tools/java",
		});
		expect(symlinks).toEqual([["java", "/data/installs/java/21.0.2"]]);
	});

	it("keep the sub-folder of a binary folder", async () => {
		const { miseService } = fakeMiseService({
			stableInstallPath: "/data/installs/erlang/global",
		});

		expect(
			await extension("pgourlain.erlang").generateConfiguration({
				tool: {
					...java,
					name: "erlang",
					install_path: "/data/installs/erlang/27",
				},
				miseService,
				miseConfig,
				useShims: true,
				useSymLinks: false,
			}),
		).toEqual({
			"erlang.erlangPath": path.join("/data/installs/erlang/global", "bin"),
		});
	});

	it("apply to custom folder extensions", async () => {
		const { miseService } = fakeMiseService({
			stableInstallPath: "/data/installs/java/global",
		});
		const custom = createCustomFolderExtensionConfig({
			extensionId: "acme.java",
			toolSources: ["java"],
			vscodeSetting: { key: "acme.javaHome", subdirs: ["jre"] },
			folderName: "acme-java",
			sourceSubdirs: ["Contents", "Home"],
		});

		expect(
			await custom.generateConfiguration({
				tool: java,
				miseService,
				miseConfig,
				useShims: true,
				useSymLinks: false,
			}),
		).toEqual({
			"acme.javaHome": path.join(
				"/data/installs/java/global",
				"Contents",
				"Home",
				"jre",
			),
		});
	});
});

describe("go.goroot", () => {
	const go = {
		name: "go",
		version: "1.22.0",
		requested_version: "1.22",
		installed: true,
		active: true,
		install_path: "/data/installs/go/1.22.0",
	};
	const generate = (miseService: MiseService) =>
		extension("golang.go").generateConfiguration({
			tool: go,
			miseService,
			miseConfig,
			useShims: false,
			useSymLinks: false,
		});

	it("goes through the global link with the go binary", async () => {
		const { miseService } = fakeMiseService({
			stableInstallPath: "/data/installs/go/global",
			which: { go: "/data/installs/go/1.22.0/bin/go" },
		});

		expect(await generate(miseService)).toEqual({
			"go.goroot": "/data/installs/go/global",
			"go.alternateTools": {
				go: path.join("/data/installs/go/global", "bin", "go"),
			},
		});
	});

	it("keeps the install when the go binary is elsewhere", async () => {
		const { miseService } = fakeMiseService({
			stableInstallPath: "/data/installs/go/global",
			which: { go: "/elsewhere/bin/go" },
		});

		expect(await generate(miseService)).toEqual({
			"go.goroot": "/data/installs/go/1.22.0",
			"go.alternateTools": { go: "/elsewhere/bin/go" },
		});
	});

	it("keeps the install a project pins", async () => {
		const { miseService } = fakeMiseService({
			stableInstallPath: "/data/installs/go/1.22.0",
			which: { go: "/data/installs/go/1.22.0/bin/go" },
		});

		expect(await generate(miseService)).toEqual({
			"go.goroot": "/data/installs/go/1.22.0",
			"go.alternateTools": {
				go: path.join("/data/installs/go/1.22.0", "bin", "go"),
			},
		});
	});
});
