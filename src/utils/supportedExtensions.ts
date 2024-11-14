import * as path from "node:path";
import type { MiseConfig } from "./miseDoctorParser";

export type VSCodeConfigValue = string | Record<string, string> | Array<string>;

export type ConfigurableExtension = {
	extensionName: string;
	toolName: string;
	generateConfiguration: (
		tool: MiseTool,
		miseConfig: MiseConfig,
		{ useShims }: { useShims: boolean },
	) => Promise<Record<string, VSCodeConfigValue>>;
};

export const SUPPORTED_EXTENSIONS: Array<ConfigurableExtension> = [
	{
		extensionName: "ms-python.python",
		toolName: "python",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims },
		) => {
			return {
				"python.defaultInterpreterPath": useShims
					? path.join(miseConfig.dirs.shims, "python")
					: path.join(tool.install_path, "bin", "python"),
			};
		},
	},
	{
		extensionName: "denoland.vscode-deno",
		toolName: "deno",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims },
		) => {
			return {
				"deno.path": useShims
					? path.join(miseConfig.dirs.shims, "deno")
					: path.join(tool.install_path, "bin", "deno"),
			};
		},
	},
	{
		extensionName: "charliermarsh.ruff",
		toolName: "ruff",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims },
		) => {
			return {
				"ruff.path": useShims
					? [path.join(miseConfig.dirs.shims, "ruff")]
					: [path.join(tool.install_path, "bin", "ruff")],
			};
		},
	},
	{
		extensionName: "golang.go",
		toolName: "go",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims },
		) => {
			if (useShims) {
				return {
					"go.goroot": tool.install_path,
					"go.alternateTools": {
						go: path.join(miseConfig.dirs.shims, "go"),
						dlv: path.join(miseConfig.dirs.shims, "dlv"),
					},
				};
			}

			return {
				"go.goroot": tool.install_path,
				"go.alternateTools": {
					go: path.join(tool.install_path, "bin", "go"),
					dlv: path.join(tool.install_path, "bin", "dlv"),
				},
			};
		},
	},
	{
		extensionName: "oven.bun-vscode",
		toolName: "bun",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims },
		) => {
			return {
				"bun.runtime": useShims
					? path.join(miseConfig.dirs.shims, "bun")
					: path.join(tool.install_path, "bin", "bun"),
			};
		},
	},
	{
		extensionName: "oracle.oracle-java",
		toolName: "java",
		generateConfiguration: async (tool: MiseTool) => {
			return {
				"jdk.jdkhome": tool.install_path,
			};
		},
	},
];
