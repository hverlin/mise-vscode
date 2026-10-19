import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "toml-v1";
import type { MiseService } from "./miseService";
import {
	type Daemon,
	daemonCommandError,
	GLOBAL_NAMESPACE,
	isDaemonActive,
	isVersionAtLeast,
	MIN_PITCHFORK_VERSION,
	type MiseDaemonEntry,
	mergeDaemons,
	type PitchforkConfigEntry,
	type PitchforkListEntry,
	parsePitchforkVersion,
	pitchforkConfigCandidates,
	sessionDaemons,
} from "./utils/daemons";
import { expandPath, locateCommand } from "./utils/fileUtils";
import { logger } from "./utils/logger";
import { safeExec } from "./utils/shell";

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
 * Nothing here starts the supervisor by itself: `pitchfork list` would, so it
 * only runs while the supervisor is up.
 */
export class DaemonsService {
	constructor(private miseService: MiseService) {}

	private folder(): string | undefined {
		return this.miseService.getCurrentWorkspaceFolderPath();
	}

	async load(): Promise<DaemonsState> {
		const [miseDaemons, pitchfork] = await Promise.all([
			this.listMiseDaemons(),
			this.findPitchfork(),
		]);
		if (!pitchfork?.supported) {
			return {
				daemons: mergeDaemons(miseDaemons, [], undefined),
				pitchfork,
				supervisor: "unknown",
			};
		}

		const [configured, status] = await Promise.all([
			this.pitchforkJson<PitchforkConfigEntry[]>(pitchfork, [
				"daemons",
				"--json",
			]).catch((error) => {
				logger.info("Could not list the daemons of pitchfork", error);
				return [];
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
						return undefined;
					})
				: undefined;

		return {
			daemons: mergeDaemons(miseDaemons, configured, listed),
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

	/**
	 * The pitchfork of the project's tools, or else the one on the PATH. mise
	 * installs one by itself when it starts a daemon, but it is not active then.
	 */
	async findPitchfork(): Promise<PitchforkBinary | undefined> {
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

	private async execPitchfork(
		pitchfork: PitchforkBinary,
		args: string[],
		cwd = this.folder(),
	): Promise<string> {
		logger.debug(`> ${pitchfork.path} ${args.join(" ")}`);
		const { code, stdout, stderr } = await safeExec(pitchfork.path, args, {
			cwd,
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

	private async execMiseDaemons(args: string[]) {
		try {
			await this.miseService.execMiseCommand(["daemons", ...args]);
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
		if (daemon.kind === "mise") {
			await this.execMiseDaemons([action, daemon.id]);
			return;
		}
		if (!pitchfork) {
			throw new DaemonCommandError("pitchfork is not installed");
		}
		await this.execPitchfork(pitchfork, [action, daemon.id]);
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
		if (project.some((daemon) => daemon.kind === "mise")) {
			await attempt(() => this.execMiseDaemons([action]));
		}
		if (pitchforkIds.length && state.pitchfork) {
			const pitchfork = state.pitchfork;
			await attempt(() =>
				this.execPitchfork(pitchfork, [action, ...pitchforkIds]),
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
	 * What a session in this folder is about: the daemons that start or stop
	 * with it (see {@link sessionDaemons}), from its mise configs and its
	 * pitchfork configs, and whether mise has to register its own first: it
	 * does that when it starts them, which a session does not.
	 */
	async sessionDaemons(
		folder: string,
	): Promise<{ daemons: string[]; register: boolean }> {
		const read = async (file: string) => {
			try {
				return sessionDaemons(parse(await readFile(file, "utf8")));
			} catch {
				// gone, or does not parse yet
				return [];
			}
		};
		const miseFiles = await this.miseDaemonSources(folder);
		const pitchforkFiles = pitchforkConfigCandidates(folder, "").filter(
			(file) => existsSync(file),
		);

		const fromMise = (
			await Promise.all(
				miseFiles.map(async (file) =>
					(await read(file)).map((daemon) => `${file}#${daemon}`),
				),
			)
		).flat();
		const fromPitchfork = (
			await Promise.all(
				pitchforkFiles.map(async (file) =>
					(await read(file)).map((daemon) => `${file}#${daemon}`),
				),
			)
		).flat();
		return {
			daemons: [...fromMise, ...fromPitchfork].sort(),
			register: fromMise.some((daemon) => /:(start|start,stop)$/.test(daemon)),
		};
	}

	private async miseDaemonSources(folder: string): Promise<string[]> {
		if (!(await this.supportsMiseDaemons())) {
			return [];
		}
		try {
			const { stdout } = await this.miseService.execMiseCommand([
				"-C",
				folder,
				"daemons",
				"ls",
				"--json",
			]);
			const daemons = JSON.parse(stdout) as MiseDaemonEntry[];
			return [
				...new Set(
					daemons
						.map((daemon) => daemon.source)
						.filter((source): source is string => !!source)
						.map(expandPath),
				),
			];
		} catch {
			return [];
		}
	}

	/**
	 * Join the pitchfork session of a folder for this window, the way a shell
	 * entering it does. pitchfork ends the session by itself once the window's
	 * process exits.
	 */
	async enterSession(
		folder: string,
		pitchfork: PitchforkBinary,
		{ register }: { register: boolean },
	): Promise<void> {
		if (register) {
			try {
				await this.miseService.execMiseCommand([
					"-C",
					folder,
					"daemons",
					"register",
				]);
			} catch (error) {
				logger.warn(
					`Could not register the daemons of ${folder}: ${daemonCommandError((error as Error).message)}`,
				);
			}
		}
		await this.execPitchfork(
			pitchfork,
			["project", "enter", "--pid", String(process.pid), "--directory", folder],
			folder,
		);
	}

	async leaveSession(
		folder: string,
		pitchfork: PitchforkBinary,
	): Promise<void> {
		await this.execPitchfork(
			pitchfork,
			["project", "leave", "--pid", String(process.pid), "--directory", folder],
			folder,
		);
	}
}
