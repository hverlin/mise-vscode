import { realpath as fsRealpath } from "node:fs/promises";
import * as path from "node:path";

/** name of the link mise keeps beside the versions of a tool (2026.10.8+) */
const GLOBAL_LINK = "global";

/** `mise ls --global --json`: the tools whose version global config selects */
export type GlobalTools = Record<string, Array<{ install_path: string }>>;

/** where mise installs the tools of this user, see `MISE_INSTALLS_DIR` */
export function getInstallsDir(miseConfig: MiseConfig): string | undefined {
	const dataDir = miseConfig.dirs?.data;
	return (
		process.env.MISE_INSTALLS_DIR ||
		(dataDir ? path.join(dataDir, "installs") : undefined)
	);
}

/**
 * The `global` link of the tool's install folder, when it is the active
 * install: `~/.local/share/mise/installs/java/global -> ./21.0.2`. mise moves
 * the link on `mise use -g`, install and upgrade, so a setting holding it does
 * not go stale like the versioned install path.
 *
 * Only for a tool whose version comes from global or system config: a project
 * pinning the same version must keep it when the global one changes. mise
 * lists only those in `globalTools`. And only in the user's own `installsDir`:
 * mise also moves the link of a shared install dir, after the global config of
 * whoever runs it there. `undefined` otherwise, or when there is no link naming
 * this install (mise older than 2026.10.8, a Windows junction that could not
 * be made).
 */
export async function getGlobalInstallPath(
	tool: Pick<MiseTool, "name" | "install_path">,
	globalTools: GlobalTools,
	installsDir: string | undefined,
	realpath: (filePath: string) => Promise<string> = fsRealpath,
): Promise<string | undefined> {
	const toolDir = path.dirname(tool.install_path);
	if (
		!installsDir ||
		path.relative(installsDir, toolDir) !== path.basename(toolDir) ||
		!globalTools[tool.name]?.some(
			(globalTool) => globalTool.install_path === tool.install_path,
		)
	) {
		return undefined;
	}

	const globalLink = path.join(toolDir, GLOBAL_LINK);
	try {
		const [linkTarget, installPath] = await Promise.all([
			realpath(globalLink),
			realpath(tool.install_path),
		]);
		return linkTarget === installPath ? globalLink : undefined;
	} catch {
		return undefined;
	}
}

/**
 * `filePath` moved from inside `fromDir` to the same place inside `toDir`,
 * e.g. a binary of the install into its `global` link. `undefined` when it is
 * not inside `fromDir`.
 */
export function rebasePath(
	filePath: string,
	fromDir: string,
	toDir: string,
): string | undefined {
	const relative = path.relative(fromDir, filePath);
	if (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		return undefined;
	}
	return path.join(toDir, relative);
}
