import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import { parse } from "toml-v1";
import type { MiseService } from "./miseService";
import {
	type Daemon,
	type DaemonGroup,
	daemonCommandError,
	declaredGroups,
	GLOBAL_NAMESPACE,
	isDaemonActive,
	isResettableDataDir,
	isVersionAtLeast,
	MIN_PITCHFORK_VERSION,
	type MiseDaemonEntry,
	mergeDaemons,
	type PitchforkConfigEntry,
	type PitchforkListEntry,
	parsePitchforkVersion,
	pitchforkConfigCandidates,
	pitchforkEnv,
	pitchforkProjectDir,
	sessionDaemons,
} from "./utils/daemons";
import { expandPath, locateCommand } from "./utils/fileUtils";
import { logger } from "./utils/logger";
import { safeExec } from "./utils/shell";

/** A parsed TOML file, or `undefined` when it does not parse */
async function readToml(file: string): Promise<unknown> {
	try {
		return parse(await readFile(file, "utf8"));
	} catch {
		return undefined;
	}
}

/** One group of each name and kind: the first, from the closest config */
const uniqueGroups = (groups: DaemonGroup[]): DaemonGroup[] =>
	groups.filter(
		(group, index) =>
			groups.findIndex(
				(other) => other.kind === group.kind && other.name === group.name,
			) === index,
	);

/** `mise daemons register`, qualified daemon ids and `--all` came with 2026.9.12 */
const MIN_MISE_VERSION_FOR_DAEMONS = [2026, 9, 12] as const;

export type PitchforkBinary = {
	path: string;
	version: [number, number, number];
	/** mise requires {@link MIN_PITCHFORK_VERSION}, and so does the extension */
	supported: boolean;
};

export type DaemonsState = {
	daemons: Daemon[];
	groups: DaemonGroup[];
	pitchfork?: PitchforkBinary;
	/** whether the pitchfork supervisor runs, which `pitchfork list` needs */
	supervisor: "up" | "down" | "unknown";
	/** the address of the pitchfork web UI, when the supervisor serves it */
	webUi?: string;
};

export type DaemonAction = "start" | "stop" | "restart";

export class DaemonCommandError extends Error {}

/**
 * The daemons of the current workspace folder: the `[daemons]` of its mise
 * configs (`mise daemons`, experimental) and those of its pitchfork configs,
 * both supervised by pitchfork.
 *
 * Nothing here starts the supervisor unless asked to start a daemon: the
 * commands that only read or stop run with its auto-start turned off.
 */
export class DaemonsService {
	/** found again on every reload, see {@link forgetPitchfork} */
	private pitchforkLookup: Promise<PitchforkBinary | undefined> | undefined;
	/** what pitchfork last reported for a folder, while its config is mid-edit */
	private lastReported = new Map<
		string,
		{ configured: PitchforkConfigEntry[]; listed?: PitchforkListEntry[] }
	>();

	constructor(private miseService: MiseService) {}

	private folder(): string | undefined {
		return this.miseService.getCurrentWorkspaceFolderPath();
	}

	async load(): Promise<DaemonsState> {
		const [miseDaemons, pitchfork, miseGroups] = await Promise.all([
			this.listMiseDaemons(),
			this.findPitchfork(),
			this.listMiseGroups(),
		]);
		if (!pitchfork?.supported) {
			return {
				daemons: mergeDaemons(miseDaemons, [], undefined),
				groups: miseGroups,
				pitchfork,
				supervisor: "unknown",
			};
		}

		const folder = this.folder() ?? "";
		const previous = this.lastReported.get(folder);
		const [configured, status] = await Promise.all([
			this.pitchforkJson<PitchforkConfigEntry[]>(pitchfork, [
				"daemons",
				"--json",
			]).catch((error) => {
				// e.g. a config that does not parse while typed
				logger.info("Could not list the daemons of pitchfork", error);
				return previous?.configured ?? [];
			}),
			this.pitchforkJson<{ status?: string; web_ui?: string | null }>(
				pitchfork,
				["supervisor", "status", "--json"],
			).catch((error) => {
				logger.info("Could not get the status of the supervisor", error);
				return undefined;
			}),
		]);
		const supervisor =
			status?.status === "up" || status?.status === "down"
				? status.status
				: "unknown";
		const listed =
			supervisor === "up"
				? await this.pitchforkJson<PitchforkListEntry[]>(pitchfork, [
						"list",
						"--json",
					]).catch((error) => {
						logger.info("Could not list the daemons of the supervisor", error);
						return previous?.listed;
					})
				: undefined;
		this.lastReported.set(folder, { configured, listed });

		return {
			daemons: mergeDaemons(miseDaemons, configured, listed),
			groups: [...miseGroups, ...(await this.listPitchforkGroups(folder))],
			pitchfork,
			supervisor,
			webUi: status?.web_ui ?? undefined,
		};
	}

	async supportsMiseDaemons(): Promise<boolean> {
		if (
			!(await this.miseService.hasValidMiseVersion(
				MIN_MISE_VERSION_FOR_DAEMONS,
			))
		) {
			return false;
		}
		// mise refuses `mise daemons` without it, and ignores `[daemons]`
		const experimental = await this.miseService
			.getSetting("experimental")
			.catch(() => undefined);
		return experimental?.trim() === "true";
	}

	private async listMiseDaemons(): Promise<MiseDaemonEntry[]> {
		if (!(await this.supportsMiseDaemons())) {
			return [];
		}
		try {
			const { stdout } = await this.miseService.execMiseCommand(
				["daemons", "ls", "--json"],
				{ retainOnParseError: true },
			);
			return JSON.parse(stdout) as MiseDaemonEntry[];
		} catch (error) {
			// e.g. an untrusted config, or safe mode
			logger.info("Could not list the daemons of mise", error);
			return [];
		}
	}

	/** The `[daemon_groups]` of the mise configs, the closest config first */
	private async listMiseGroups(): Promise<DaemonGroup[]> {
		if (!(await this.supportsMiseDaemons())) {
			return [];
		}
		const files = (await this.miseService.getMiseConfigFiles().catch(() => []))
			.map((file) => expandPath(file.path))
			.filter((file) => file.endsWith(".toml"));
		return uniqueGroups(
			(
				await Promise.all(
					files.map(async (file) =>
						declaredGroups(await readToml(file), "mise", file),
					),
				)
			).flat(),
		);
	}

	/** The `[groups]` of the pitchfork configs of a project */
	private async listPitchforkGroups(folder: string): Promise<DaemonGroup[]> {
		if (!folder) {
			return [];
		}
		const files = pitchforkConfigCandidates(folder, "").filter((file) =>
			existsSync(file),
		);
		return uniqueGroups(
			(
				await Promise.all(
					files.map(async (file) =>
						declaredGroups(await readToml(file), "pitchfork", file),
					),
				)
			).flat(),
		);
	}

	/**
	 * The pitchfork of the project's tools, or else the one on the PATH. mise
	 * installs one by itself when it starts a daemon, but it is not active then.
	 * Looked up once until {@link forgetPitchfork}.
	 */
	findPitchfork(): Promise<PitchforkBinary | undefined> {
		this.pitchforkLookup ??= this.lookUpPitchfork();
		return this.pitchforkLookup;
	}

	/** On a reload: the tools, or the PATH, may have changed */
	forgetPitchfork() {
		this.pitchforkLookup = undefined;
	}

	private async lookUpPitchfork(): Promise<PitchforkBinary | undefined> {
		// only along with mise, e.g. not before a workspace mise is approved
		if (!this.miseService.getMiseBinaryPath()) {
			return undefined;
		}
		const candidates = [
			await this.miseService.which("pitchfork"),
			locateCommand("pitchfork"),
		].filter((candidate): candidate is string => !!candidate);

		for (const candidate of new Set(candidates)) {
			const { code, stdout } = await safeExec(candidate, ["--version"]);
			const version = code === 0 ? parsePitchforkVersion(stdout) : undefined;
			if (version) {
				return {
					path: candidate,
					version,
					supported: isVersionAtLeast(version, MIN_PITCHFORK_VERSION),
				};
			}
		}
		return undefined;
	}

	/**
	 * Run pitchfork. Only the commands that start daemons may start the
	 * supervisor (`autoStart`).
	 */
	private async execPitchfork(
		pitchfork: PitchforkBinary,
		args: string[],
		{
			cwd = this.folder(),
			autoStart = false,
		}: { cwd?: string; autoStart?: boolean } = {},
	): Promise<string> {
		logger.debug(`> ${pitchfork.path} ${args.join(" ")}`);
		const { code, stdout, stderr } = await safeExec(pitchfork.path, args, {
			cwd,
			env: pitchforkEnv({ autoStart }),
		});
		if (code !== 0) {
			throw new DaemonCommandError(
				daemonCommandError(stderr || stdout) ||
					`pitchfork ${args.join(" ")} failed`,
			);
		}
		return stdout;
	}

	private async pitchforkJson<T>(
		pitchfork: PitchforkBinary,
		args: string[],
	): Promise<T> {
		return JSON.parse(await this.execPitchfork(pitchfork, args)) as T;
	}

	/** mise runs pitchfork, which starts the supervisor unless told not to */
	private async execMiseDaemons(args: string[], { autoStart = false } = {}) {
		try {
			await this.miseService.execMiseCommand(["daemons", ...args], {
				env: pitchforkEnv({ autoStart }),
			});
		} catch (error) {
			throw new DaemonCommandError(
				daemonCommandError((error as Error).message),
			);
		}
	}

	/**
	 * Start, stop or restart a daemon. mise installs the tools of its daemons,
	 * and registers them with pitchfork first. Starting waits until the daemon
	 * is ready.
	 */
	async run(
		action: DaemonAction,
		daemon: Daemon,
		pitchfork: PitchforkBinary | undefined,
	): Promise<void> {
		const autoStart = action !== "stop";
		if (daemon.kind === "mise") {
			await this.execMiseDaemons([action, daemon.id], { autoStart });
			return;
		}
		if (!pitchfork) {
			throw new DaemonCommandError("pitchfork is not installed");
		}
		await this.execPitchfork(pitchfork, [action, daemon.id], { autoStart });
	}

	/** Start, stop or restart the daemons of a group */
	async runGroup(
		action: DaemonAction,
		group: DaemonGroup,
		pitchfork: PitchforkBinary | undefined,
	): Promise<void> {
		const autoStart = action !== "stop";
		if (group.kind === "mise") {
			await this.execMiseDaemons([action, "--group", group.name], {
				autoStart,
			});
			return;
		}
		if (!pitchfork) {
			throw new DaemonCommandError("pitchfork is not installed");
		}
		await this.execPitchfork(pitchfork, [action, "--group", group.name], {
			autoStart,
		});
	}

	/**
	 * Reset the data of a preset, as the mise docs say: stop it, remove its
	 * data directory (the directory itself: mise refuses to start a preset
	 * whose directory lacks the marker it writes), and start it, which
	 * initializes fresh data.
	 */
	async resetData(daemon: Daemon): Promise<void> {
		const { dataDir } = daemon;
		const folders = this.folder() ? [this.folder() as string] : [];
		if (
			daemon.kind !== "mise" ||
			!dataDir ||
			!isResettableDataDir(dataDir, [os.homedir(), ...folders])
		) {
			throw new DaemonCommandError(
				`${daemon.name} has no data directory that can be reset`,
			);
		}
		if (isDaemonActive(daemon)) {
			await this.execMiseDaemons(["stop", daemon.id]);
		}
		logger.info(`Removing the data of ${daemon.id}: ${dataDir}`);
		await rm(dataDir, { recursive: true, force: true });
		await this.execMiseDaemons(["start", daemon.id], { autoStart: true });
	}

	/**
	 * Start the daemons of the project, or stop the ones that run. For mise,
	 * that is what `mise daemons start` and `stop` do: the `default` group, or
	 * every daemon. The global daemons are left alone.
	 */
	async runAll(action: "start" | "stop", state: DaemonsState): Promise<void> {
		const project = state.daemons.filter(
			(daemon) => daemon.namespace !== GLOBAL_NAMESPACE,
		);
		const pitchforkIds = project
			.filter(
				(daemon) =>
					daemon.kind === "pitchfork" &&
					isDaemonActive(daemon) === (action === "stop"),
			)
			.map((daemon) => daemon.id);

		const errors: string[] = [];
		const attempt = async (run: () => Promise<unknown>) => {
			try {
				await run();
			} catch (error) {
				errors.push((error as Error).message);
			}
		};
		const autoStart = action === "start";
		if (project.some((daemon) => daemon.kind === "mise")) {
			await attempt(() => this.execMiseDaemons([action], { autoStart }));
		}
		if (pitchforkIds.length && state.pitchfork) {
			const pitchfork = state.pitchfork;
			await attempt(() =>
				this.execPitchfork(pitchfork, [action, ...pitchforkIds], {
					autoStart,
				}),
			);
		}
		if (errors.length) {
			throw new DaemonCommandError(errors.join(" "));
		}
	}

	/** A command line running in a terminal, without a shell in between */
	logsCommand(
		daemon: Daemon,
		pitchfork: PitchforkBinary | undefined,
	): { shellPath: string; shellArgs: string[] } | undefined {
		if (pitchfork?.supported) {
			return {
				shellPath: pitchfork.path,
				shellArgs: ["logs", daemon.id, "-n", "200", "--tail"],
			};
		}
		const mise = this.miseService.getMiseBinaryPath();
		if (daemon.kind !== "mise" || !mise) {
			return undefined;
		}
		return {
			shellPath: mise,
			shellArgs: this.miseService.buildMiseArgs([
				"daemons",
				"logs",
				daemon.id,
				"-n",
				"200",
				"--tail",
			]),
		};
	}

	tuiCommand(
		pitchfork: PitchforkBinary | undefined,
	): { shellPath: string; shellArgs: string[] } | undefined {
		if (pitchfork?.supported) {
			return { shellPath: pitchfork.path, shellArgs: ["tui"] };
		}
		const mise = this.miseService.getMiseBinaryPath();
		return mise
			? {
					shellPath: mise,
					shellArgs: this.miseService.buildMiseArgs(["daemons", "tui"]),
				}
			: undefined;
	}

	/**
	 * The projects a session in this folder joins, by root directory, with the
	 * daemons that start or stop with them (see {@link sessionDaemons}). A
	 * project is where its config is, which can be above the folder, and
	 * pitchfork only stops on leaving the daemons of a directory inside the one
	 * left. mise registers its daemons with pitchfork when it starts them,
	 * which a session does not, so a root whose mise daemons start with the
	 * session is registered first.
	 *
	 * `undefined` when a config could not be read, e.g. while it is typed: the
	 * session stays as it was rather than leaving.
	 */
	async sessionRoots(
		folder: string,
	): Promise<
		Map<string, { daemons: string[]; register: boolean }> | undefined
	> {
		const roots = new Map<string, { daemons: string[]; register: boolean }>();
		const add = (root: string, daemons: string[], register: boolean) => {
			if (!daemons.length) {
				return;
			}
			const entry = roots.get(root) ?? { daemons: [], register: false };
			entry.daemons.push(...daemons);
			entry.register ||= register;
			roots.set(root, entry);
		};
		const read = async (file: string) =>
			parse(await readFile(file, "utf8")) as unknown;

		try {
			// the daemons a config file declares for a project
			const bySource = new Map<
				string,
				{ root: string; source: string; names: string[] }
			>();
			for (const daemon of await this.miseSessionCandidates(folder)) {
				const key = JSON.stringify([daemon.root, daemon.source]);
				const entry = bySource.get(key) ?? { ...daemon, names: [] };
				entry.names.push(daemon.name);
				bySource.set(key, entry);
			}
			for (const { root, source, names } of bySource.values()) {
				const declared = sessionDaemons(await read(source), names).map(
					(daemon) => `${source}#${daemon}`,
				);
				add(
					root,
					declared,
					declared.some((daemon) => /:start(,stop)?$/.test(daemon)),
				);
			}

			for (const file of pitchforkConfigCandidates(folder, "").filter((file) =>
				existsSync(file),
			)) {
				add(
					pitchforkProjectDir(file),
					sessionDaemons(await read(file)).map((daemon) => `${file}#${daemon}`),
					false,
				);
			}
		} catch (error) {
			logger.info(`Could not read the session daemons of ${folder}`, error);
			return undefined;
		}

		for (const entry of roots.values()) {
			entry.daemons.sort();
		}
		return roots;
	}

	/** The mise daemons seen from a folder, with their project and config */
	private async miseSessionCandidates(
		folder: string,
	): Promise<{ name: string; root: string; source: string }[]> {
		if (!(await this.supportsMiseDaemons())) {
			return [];
		}
		const { stdout } = await this.miseService.execMiseCommand([
			"-C",
			folder,
			"daemons",
			"ls",
			"--json",
		]);
		return (JSON.parse(stdout) as MiseDaemonEntry[]).flatMap((daemon) =>
			daemon.root && daemon.source
				? [
						{
							name: daemon.name,
							root: expandPath(daemon.root),
							source: expandPath(daemon.source),
						},
					]
				: [],
		);
	}

	/**
	 * Join the pitchfork session of a project for this window, the way a shell
	 * entering it does. pitchfork ends the session by itself once the window's
	 * process exits.
	 */
	async enterSession(
		root: string,
		pitchfork: PitchforkBinary,
		{ register }: { register: boolean },
	): Promise<void> {
		if (register) {
			try {
				await this.miseService.execMiseCommand(
					["-C", root, "daemons", "register"],
					{ env: pitchforkEnv({ autoStart: true }) },
				);
			} catch (error) {
				logger.warn(
					`Could not register the daemons of ${root}: ${daemonCommandError((error as Error).message)}`,
				);
			}
		}
		await this.execPitchfork(
			pitchfork,
			["project", "enter", "--pid", String(process.pid), "--directory", root],
			{ cwd: root, autoStart: true },
		);
	}

	/** Leaving never starts a supervisor: without one, there is no session */
	async leaveSession(root: string, pitchfork: PitchforkBinary): Promise<void> {
		await this.execPitchfork(
			pitchfork,
			["project", "leave", "--pid", String(process.pid), "--directory", root],
			{ cwd: root },
		);
	}
}
