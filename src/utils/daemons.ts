import os from "node:os";
import path from "node:path";

/** An entry of `mise daemons ls --json`: the `[daemons]` of the mise configs */
export type MiseDaemonEntry = {
	id: string;
	name: string;
	status: string;
	/** the project directory the daemon belongs to */
	root?: string | null;
	/** the mise config file declaring the daemon */
	source?: string | null;
	preset?: string | null;
	pid?: number | null;
	port?: number | null;
	url?: string | null;
	/** `off` for a daemon the pitchfork proxy does not serve, e.g. a database */
	proxy?: string | null;
};

/** An entry of `pitchfork daemons --json`: a daemon of the pitchfork configs */
export type PitchforkConfigEntry = {
	id: string;
	run?: string | null;
};

/** An entry of `pitchfork list --json`: the daemons the supervisor knows */
export type PitchforkListEntry = {
	id: string;
	namespace: string;
	name: string;
	status: string;
	pid?: number | null;
	disabled?: boolean;
	url?: string | null;
	error?: string | null;
	active_port?: number | null;
	port?: number[] | null;
};

export type Daemon = {
	/** `namespace/name`, what pitchfork calls it */
	id: string;
	name: string;
	namespace: string;
	/** declared in the `[daemons]` of a mise config, or in a pitchfork config */
	kind: "mise" | "pitchfork";
	status: string;
	pid?: number;
	port?: number;
	/** where a browser reaches it, for an HTTP daemon */
	url?: string;
	error?: string;
	preset?: string;
	run?: string;
	/** for a mise daemon, the config file declaring it */
	source?: string;
	/** for a mise daemon, the project it belongs to */
	root?: string;
	disabled: boolean;
};

/** The namespace of the daemons of the user's own pitchfork config */
export const GLOBAL_NAMESPACE = "global";

/** mise requires it, and the commands used here are all older */
export const MIN_PITCHFORK_VERSION = [2, 25, 0] as const;

const ACTIVE_STATUSES = new Set([
	"running",
	"waiting",
	"stopping",
	"restarting",
]);

/** Whether the daemon has a process: running, or about to change state */
export const isDaemonActive = (daemon: Pick<Daemon, "status">) =>
	ACTIVE_STATUSES.has(daemon.status);

export const isDaemonFailed = (daemon: Pick<Daemon, "status">) =>
	daemon.status === "errored" || daemon.status === "failed";

const namespaceOf = (id: string) => {
	const slash = id.lastIndexOf("/");
	return slash === -1 ? GLOBAL_NAMESPACE : id.slice(0, slash);
};

const nameOf = (id: string) => id.slice(id.lastIndexOf("/") + 1);

const portOf = (entry: PitchforkListEntry | undefined) =>
	entry?.active_port ?? entry?.port?.[0] ?? undefined;

/**
 * The daemons of a project: those of its mise configs, then those of its
 * pitchfork configs, with what the supervisor reports about them when it runs.
 * Once mise starts its daemons, pitchfork also lists them as its own, with the
 * same ids. Daemons started without a config (`pitchfork run`) are kept while
 * they run, if they belong to a namespace of the project.
 */
export function mergeDaemons(
	miseDaemons: MiseDaemonEntry[],
	configured: PitchforkConfigEntry[],
	listed: PitchforkListEntry[] | undefined,
): Daemon[] {
	const live = new Map((listed ?? []).map((entry) => [entry.id, entry]));
	const daemons = new Map<string, Daemon>();

	for (const entry of miseDaemons) {
		const state = live.get(entry.id);
		const port = portOf(state) ?? entry.port ?? undefined;
		daemons.set(entry.id, {
			id: entry.id,
			name: entry.name,
			namespace: namespaceOf(entry.id),
			kind: "mise",
			status: state?.status ?? entry.status,
			pid: state?.pid ?? entry.pid ?? undefined,
			port,
			// mise names a proxy hostname even when the proxy is off: only the
			// supervisor knows whether it serves it
			url:
				state?.url ??
				(port !== undefined && entry.proxy && entry.proxy !== "off"
					? `http://localhost:${port}`
					: undefined),
			error: state?.error ?? undefined,
			preset: entry.preset ?? undefined,
			source: entry.source ?? undefined,
			root: entry.root ?? undefined,
			disabled: state?.disabled ?? false,
		});
	}

	const fromPitchfork = (id: string, run?: string | null): Daemon => {
		const state = live.get(id);
		return {
			id,
			name: state?.name ?? nameOf(id),
			namespace: state?.namespace ?? namespaceOf(id),
			kind: "pitchfork",
			// declared, never started
			status: state?.status ?? "available",
			pid: state?.pid ?? undefined,
			port: portOf(state),
			url: state?.url ?? undefined,
			error: state?.error ?? undefined,
			run: run ?? undefined,
			disabled: state?.disabled ?? false,
		};
	};

	for (const entry of configured) {
		if (!daemons.has(entry.id)) {
			daemons.set(entry.id, fromPitchfork(entry.id, entry.run));
		}
	}

	const namespaces = new Set(
		[...daemons.values()].map((daemon) => daemon.namespace),
	);
	for (const entry of listed ?? []) {
		if (
			!daemons.has(entry.id) &&
			isDaemonActive(entry) &&
			(namespaces.has(entry.namespace) || entry.namespace === GLOBAL_NAMESPACE)
		) {
			daemons.set(entry.id, fromPitchfork(entry.id));
		}
	}

	return [...daemons.values()].sort(
		(a, b) =>
			Number(a.namespace === GLOBAL_NAMESPACE) -
				Number(b.namespace === GLOBAL_NAMESPACE) ||
			a.namespace.localeCompare(b.namespace) ||
			a.name.localeCompare(b.name),
	);
}

/** `pitchfork 2.31.0` */
export function parsePitchforkVersion(
	output: string,
): [number, number, number] | undefined {
	const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
	if (!match) {
		return undefined;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isVersionAtLeast(
	version: readonly [number, number, number],
	minimum: readonly [number, number, number],
): boolean {
	for (let i = 0; i < 3; i++) {
		const [actual = 0, expected = 0] = [version[i], minimum[i]];
		if (actual !== expected) {
			return actual > expected;
		}
	}
	return true;
}

const PROJECT_CONFIG_NAMES = [
	"pitchfork.local.toml",
	"pitchfork.toml",
	path.join(".config", "pitchfork.local.toml"),
	path.join(".config", "pitchfork.toml"),
];

/** The user's pitchfork config, `~/.config/pitchfork/config.toml` by default */
export function pitchforkUserConfig(env = process.env): string {
	return path.join(
		env.PITCHFORK_CONFIG_DIR || path.join(os.homedir(), ".config", "pitchfork"),
		"config.toml",
	);
}

const PITCHFORK_SYSTEM_CONFIG = "/etc/pitchfork/config.toml";

/**
 * The pitchfork configs that can declare a daemon seen from `directory`, the
 * ones that win first: those of the directory and its parents for a project
 * daemon (a local file overrides its neighbour), the user's and the system's
 * for a global one.
 */
export function pitchforkConfigCandidates(
	directory: string,
	namespace: string,
	env = process.env,
): string[] {
	if (namespace === GLOBAL_NAMESPACE) {
		return [pitchforkUserConfig(env), PITCHFORK_SYSTEM_CONFIG];
	}
	const candidates: string[] = [];
	for (
		let current = path.resolve(directory);
		;
		current = path.dirname(current)
	) {
		for (const name of PROJECT_CONFIG_NAMES) {
			candidates.push(path.join(current, name));
		}
		if (path.dirname(current) === current) {
			return candidates;
		}
	}
}

/** Whether two paths name the same file, ignoring the case of Windows paths */
export function isSamePath(
	a: string,
	b: string,
	windows = process.platform === "win32",
): boolean {
	const normalize = (filePath: string) =>
		windows ? path.resolve(filePath).toLowerCase() : path.resolve(filePath);
	return normalize(a) === normalize(b);
}

/** Whether pitchfork reads daemons from this file */
export function isPitchforkConfigPath(filePath: string, env = process.env) {
	const normalized = path.resolve(filePath);
	if (
		normalized === path.resolve(pitchforkUserConfig(env)) ||
		normalized === PITCHFORK_SYSTEM_CONFIG
	) {
		return true;
	}
	const base = path.basename(normalized);
	if (base !== "pitchfork.toml" && base !== "pitchfork.local.toml") {
		return false;
	}
	// `.config/pitchfork.toml`, or one of a project directory
	return true;
}

/** The names of the daemons a parsed config declares under `[daemons]` */
export function declaredDaemonNames(config: unknown): string[] {
	const daemons = (config as { daemons?: unknown } | undefined)?.daemons;
	if (!daemons || typeof daemons !== "object" || Array.isArray(daemons)) {
		return [];
	}
	return Object.keys(daemons);
}

/**
 * The daemons of a parsed config that a session starts or stops, from their
 * `auto` key: the shell hook, or the editor, starts the `auto = ["start"]`
 * ones when entering the project, and stops the `auto = ["stop"]` ones once
 * the last session left. As `name:start,stop`, for the names given or all.
 */
export function sessionDaemons(config: unknown, names?: string[]): string[] {
	const daemons = (config as { daemons?: Record<string, unknown> } | undefined)
		?.daemons;
	if (!daemons || typeof daemons !== "object") {
		return [];
	}
	return Object.entries(daemons).flatMap(([name, daemon]) => {
		if (names && !names.includes(name)) {
			return [];
		}
		const auto = (daemon as { auto?: unknown } | undefined)?.auto;
		const actions = Array.isArray(auto)
			? auto.filter(
					(action): action is string => action === "start" || action === "stop",
				)
			: [];
		return actions.length ? [`${name}:${[...actions].sort().join(",")}`] : [];
	});
}

/**
 * The project directory of a pitchfork config, the one its daemons belong to:
 * where the file is, or the directory above its `.config`.
 */
export function pitchforkProjectDir(configPath: string): string {
	const directory = path.dirname(configPath);
	return path.basename(directory) === ".config"
		? path.dirname(directory)
		: directory;
}

/**
 * The namespace pitchfork gives the daemons of a config: `global` for the
 * user's and the system's, else its `namespace`, or the name of its project
 * directory.
 */
export function pitchforkNamespace(
	configPath: string,
	config: unknown,
	env = process.env,
): string {
	if (
		isSamePath(configPath, pitchforkUserConfig(env)) ||
		isSamePath(configPath, PITCHFORK_SYSTEM_CONFIG)
	) {
		return GLOBAL_NAMESPACE;
	}
	const declared = (config as { namespace?: unknown } | undefined)?.namespace;
	if (typeof declared === "string" && declared) {
		return declared;
	}
	return path.basename(pitchforkProjectDir(configPath));
}

/**
 * The environment of a command that may start the pitchfork supervisor: it
 * outlives the editor and every daemon inherits it, so none of the variables
 * VS Code sets for its own processes (`ELECTRON_RUN_AS_NODE`, ...) go there.
 * `autoStart: false` keeps a command from starting one.
 */
export function pitchforkEnv(
	{ autoStart }: { autoStart: boolean },
	env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const result: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(env)) {
		if (!/^(VSCODE_|ELECTRON_)/.test(key)) {
			result[key] = value;
		}
	}
	if (!autoStart) {
		result.PITCHFORK_SUPERVISOR_AUTO_START = "false";
	}
	return result;
}

const ANSI_ESCAPE = new RegExp(
	`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`,
	"g",
);

/**
 * What went wrong, from the output of a failed mise or pitchfork command: the
 * error lines of mise without its footer, or what pitchfork printed.
 */
export function daemonCommandError(output: string): string {
	const lines = output
		.replace(ANSI_ESCAPE, "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !line.startsWith("Command failed:"));
	const miseErrors = lines
		.filter((line) => line.startsWith("mise ERROR"))
		.map((line) => line.replace(/^mise ERROR\s*/, ""))
		.filter(
			(line) => !line.startsWith("Version:") && !line.startsWith("Run with"),
		);
	const relevant = miseErrors.length ? miseErrors : lines.slice(-3);
	return relevant.join(" ").replace(/^(Error:\s*)?×\s*/, "");
}

/** What the view shows next to a daemon: its status, and its port */
export function describeDaemon(daemon: Daemon): string {
	const parts = [daemon.disabled ? "disabled" : daemon.status];
	if (daemon.port !== undefined && isDaemonActive(daemon)) {
		parts.push(`:${daemon.port}`);
	}
	return parts.join(" · ");
}
