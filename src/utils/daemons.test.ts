import { describe, expect, it } from "bun:test";
import path from "node:path";
import {
	daemonCommandError,
	declaredDaemonNames,
	declaredGroups,
	describeDaemon,
	groupDaemons,
	isPitchforkConfigPath,
	isResettableDataDir,
	isSamePath,
	isVersionAtLeast,
	mergeDaemons,
	newlyFailedDaemons,
	type PitchforkListEntry,
	parsePitchforkVersion,
	pitchforkConfigCandidates,
	pitchforkEnv,
	pitchforkProjectDir,
	sessionDaemons,
	summarizeDaemons,
} from "./daemons";

const listed = (
	id: string,
	status: string,
	extra: Partial<PitchforkListEntry> = {},
): PitchforkListEntry => ({
	id,
	namespace: id.split("/")[0] ?? "",
	name: id.split("/")[1] ?? "",
	status,
	pid: null,
	disabled: false,
	url: null,
	error: null,
	port: [],
	...extra,
});

describe("mergeDaemons", () => {
	const miseWeb = {
		id: "shop/web",
		name: "web",
		status: "available",
		source: "/repo/shop/mise.toml",
		preset: null,
		pid: null,
		port: 3000,
		url: "https://web.shop.localhost",
		proxy: "terminate",
	};

	it("lists the mise daemons, then the pitchfork ones", () => {
		const daemons = mergeDaemons(
			[miseWeb],
			[{ id: "shop/clock", run: "date" }],
			undefined,
		);
		expect(
			daemons.map(({ id, kind, status, source, run }) => ({
				id,
				kind,
				status,
				source,
				run,
			})),
		).toEqual([
			{
				id: "shop/clock",
				kind: "pitchfork",
				status: "available",
				source: undefined,
				run: "date",
			},
			{
				id: "shop/web",
				kind: "mise",
				status: "available",
				source: "/repo/shop/mise.toml",
				run: undefined,
			},
		]);
	});

	it("takes the status from the supervisor, and keeps the mise ones as mise's", () => {
		const [web] = mergeDaemons(
			[miseWeb],
			// mise registered it: pitchfork has it as its own too
			[{ id: "shop/web", run: "exec npm run dev" }],
			[listed("shop/web", "running", { pid: 42, active_port: 3001 })],
		);
		expect(web).toMatchObject({
			kind: "mise",
			status: "running",
			pid: 42,
			port: 3001,
			// the proxy hostname only when the supervisor reports it
			url: "http://localhost:3001",
		});
	});

	it("opens only HTTP daemons in the browser", () => {
		const [postgres] = mergeDaemons(
			[{ ...miseWeb, id: "shop/postgres", name: "postgres", proxy: "off" }],
			[],
			undefined,
		);
		expect(postgres?.url).toBeUndefined();
		const [proxied] = mergeDaemons(
			[miseWeb],
			[],
			[listed("shop/web", "running", { url: "https://web.shop.localhost" })],
		);
		expect(proxied?.url).toBe("https://web.shop.localhost");
	});

	it("keeps the daemons running without a config, in the namespaces shown", () => {
		const daemons = mergeDaemons(
			[],
			[{ id: "shop/clock" }],
			[
				listed("shop/once", "running"),
				listed("shop/old", "errored"),
				listed("other/api", "running"),
				listed("global/watch", "running"),
			],
		);
		expect(daemons.map((daemon) => daemon.id)).toEqual([
			"shop/clock",
			"shop/once",
			// the global ones come last
			"global/watch",
		]);
	});

	it("reports the error of a failed daemon", () => {
		const [clock] = mergeDaemons(
			[],
			[{ id: "shop/clock" }],
			[listed("shop/clock", "errored", { error: "exit code 1" })],
		);
		expect(clock).toMatchObject({ status: "errored", error: "exit code 1" });
	});
});

describe("describeDaemon", () => {
	it("shows the port of a running daemon", () => {
		const [web, clock] = mergeDaemons(
			[],
			[{ id: "shop/web" }, { id: "shop/worker" }],
			[listed("shop/web", "running", { port: [3000] })],
		);
		expect(web && describeDaemon(web)).toBe("running · :3000");
		expect(clock && describeDaemon(clock)).toBe("available");
	});
});

describe("pitchfork versions", () => {
	it("parses `pitchfork --version`", () => {
		expect(parsePitchforkVersion("pitchfork 2.31.0\n")).toEqual([2, 31, 0]);
		expect(parsePitchforkVersion("pitchfork")).toBeUndefined();
	});

	it("compares versions", () => {
		expect(isVersionAtLeast([2, 25, 0], [2, 25, 0])).toBe(true);
		expect(isVersionAtLeast([2, 31, 0], [2, 25, 0])).toBe(true);
		expect(isVersionAtLeast([2, 23, 9], [2, 25, 0])).toBe(false);
		expect(isVersionAtLeast([3, 0, 0], [2, 25, 0])).toBe(true);
	});
});

describe("pitchfork configs", () => {
	const env = { PITCHFORK_CONFIG_DIR: path.join(path.sep, "home", "pf") };

	it("looks for a project daemon in the folder, then its parents", () => {
		const candidates = pitchforkConfigCandidates(
			path.join(path.sep, "repo", "shop"),
			"shop",
			env,
		);
		expect(candidates.slice(0, 5)).toEqual([
			path.join(path.sep, "repo", "shop", "pitchfork.local.toml"),
			path.join(path.sep, "repo", "shop", "pitchfork.toml"),
			path.join(path.sep, "repo", "shop", ".config", "pitchfork.local.toml"),
			path.join(path.sep, "repo", "shop", ".config", "pitchfork.toml"),
			path.join(path.sep, "repo", "pitchfork.local.toml"),
		]);
		expect(candidates.at(-1)).toBe(
			path.join(path.sep, ".config", "pitchfork.toml"),
		);
	});

	it("looks for a global daemon in the user's config", () => {
		expect(pitchforkConfigCandidates("/repo", "global", env)[0]).toBe(
			path.join(path.sep, "home", "pf", "config.toml"),
		);
	});

	it("tells the files pitchfork reads daemons from", () => {
		expect(isPitchforkConfigPath("/repo/pitchfork.toml", env)).toBe(true);
		expect(isPitchforkConfigPath("/repo/pitchfork.local.toml", env)).toBe(true);
		expect(isPitchforkConfigPath("/repo/.config/pitchfork.toml", env)).toBe(
			true,
		);
		expect(
			isPitchforkConfigPath(
				path.join(path.sep, "home", "pf", "config.toml"),
				env,
			),
		).toBe(true);
		expect(isPitchforkConfigPath("/repo/mise.toml", env)).toBe(false);
		expect(isPitchforkConfigPath("/repo/config.toml", env)).toBe(false);
	});
});

describe("declared daemons", () => {
	it("lists the names under [daemons]", () => {
		expect(
			declaredDaemonNames({ daemons: { postgres: "18", api: { run: "x" } } }),
		).toEqual(["postgres", "api"]);
		expect(declaredDaemonNames({ tools: {} })).toEqual([]);
	});

	it("lists the daemons a session starts or stops", () => {
		expect(
			sessionDaemons({
				daemons: {
					postgres: "18",
					api: { run: "x", auto: ["stop", "start"] },
					worker: { run: "y", auto: ["stop"] },
					web: { run: "z" },
				},
			}),
		).toEqual(["api:start,stop", "worker:stop"]);
	});

	it("keeps to the daemons named", () => {
		expect(
			sessionDaemons(
				{
					daemons: {
						api: { auto: ["start"] },
						worker: { auto: ["stop"] },
					},
				},
				["worker"],
			),
		).toEqual(["worker:stop"]);
	});
});

describe("pitchforkProjectDir", () => {
	it("is the directory of the config, or the one above .config", () => {
		expect(pitchforkProjectDir("/repo/shop/pitchfork.toml")).toBe(
			path.resolve("/repo/shop"),
		);
		expect(pitchforkProjectDir("/repo/shop/.config/pitchfork.toml")).toBe(
			path.resolve("/repo/shop"),
		);
	});
});

describe("pitchforkEnv", () => {
	const env = {
		PATH: "/usr/bin",
		ELECTRON_RUN_AS_NODE: "1",
		VSCODE_PID: "42",
		MISE_ENV: "dev",
	};

	it("leaves out what VS Code sets for its own processes", () => {
		expect(pitchforkEnv({ autoStart: true }, env)).toEqual({
			PATH: "/usr/bin",
			MISE_ENV: "dev",
		});
	});

	it("keeps pitchfork from starting a supervisor", () => {
		expect(
			pitchforkEnv({ autoStart: false }, env).PITCHFORK_SUPERVISOR_AUTO_START,
		).toBe("false");
	});
});

describe("isSamePath", () => {
	it("ignores the case of Windows paths only", () => {
		expect(isSamePath("/repo/mise.toml", "/repo/./mise.toml", false)).toBe(
			true,
		);
		expect(isSamePath("/Repo/mise.toml", "/repo/mise.toml", false)).toBe(false);
		expect(isSamePath("/Repo/mise.toml", "/repo/mise.toml", true)).toBe(true);
	});
});

describe("daemonCommandError", () => {
	it("keeps the error of mise, without its footer", () => {
		expect(
			daemonCommandError(
				[
					"Command failed: mise daemons start shop/web",
					"\u001b[31mmise ERROR\u001b[0m daemon web: port 3000 is in use",
					"mise ERROR Version: 2026.10.14 macos-arm64 (2026-10-18)",
					"mise ERROR Run with --verbose or MISE_VERBOSE=1 for more information",
				].join("\n"),
			),
		).toBe("daemon web: port 3000 is in use");
	});

	it("keeps what pitchfork printed", () => {
		expect(daemonCommandError("Error:   × Daemon shop/web not found\n")).toBe(
			"Daemon shop/web not found",
		);
	});
});

describe("daemon groups", () => {
	const daemons = mergeDaemons(
		[
			{ id: "shop/web", name: "web", status: "running" },
			{ id: "shop/api", name: "api", status: "available" },
			{ id: "shop/db", name: "db", status: "available" },
		],
		[{ id: "shop/clock" }],
		undefined,
	);

	it("reads mise groups in both forms, and pitchfork ones", () => {
		expect(
			declaredGroups(
				{
					daemon_groups: {
						default: ["web"],
						full: { daemons: ["default", "api"] },
					},
				},
				"mise",
				"/shop/mise.toml",
			),
		).toEqual([
			{
				name: "default",
				kind: "mise",
				members: ["web"],
				source: "/shop/mise.toml",
			},
			{
				name: "full",
				kind: "mise",
				members: ["default", "api"],
				source: "/shop/mise.toml",
			},
		]);
		expect(
			declaredGroups(
				{ groups: { all: { daemons: ["clock"], groups: ["backend"] } } },
				"pitchfork",
				"/shop/pitchfork.toml",
			),
		).toEqual([
			{
				name: "all",
				kind: "pitchfork",
				members: ["clock", "backend"],
				source: "/shop/pitchfork.toml",
			},
		]);
		expect(declaredGroups({ groups: {} }, "mise", "/x")).toEqual([]);
	});

	it("expands the groups a group names, once", () => {
		const groups = declaredGroups(
			{
				daemon_groups: {
					default: ["web", "full"],
					full: ["default", "api", "shop/db", "gone"],
				},
			},
			"mise",
			"/shop/mise.toml",
		);
		const [defaultGroup] = groups;
		expect(
			defaultGroup &&
				groupDaemons(defaultGroup, groups, daemons).map((daemon) => daemon.id),
		).toEqual(["shop/web", "shop/api", "shop/db"]);
	});

	it("keeps to the daemons of the same kind", () => {
		const [group] = declaredGroups(
			{ daemon_groups: { all: ["web", "clock"] } },
			"mise",
			"/shop/mise.toml",
		);
		expect(
			group && groupDaemons(group, [group], daemons).map((daemon) => daemon.id),
		).toEqual(["shop/web"]);
	});
});

describe("preset data", () => {
	it("comes from mise", () => {
		const [db] = mergeDaemons(
			[
				{
					id: "shop/db",
					name: "db",
					status: "available",
					data_dir: "/state/db/data",
					data_size_human: "52 MB",
				},
			],
			[],
			undefined,
		);
		expect(db).toMatchObject({ dataDir: "/state/db/data", dataSize: "52 MB" });
	});

	it("is only removed from a directory that holds nothing else", () => {
		const home = path.join(path.sep, "home", "me");
		const keep = [home, path.join(home, "shop")];
		expect(
			isResettableDataDir(path.join(home, ".local", "state", "db"), keep),
		).toBe(true);
		expect(
			isResettableDataDir(path.join(home, "shop", ".data", "db"), keep),
		).toBe(true);
		expect(isResettableDataDir(home, keep)).toBe(false);
		expect(isResettableDataDir(path.join(home, "shop"), keep)).toBe(false);
		expect(isResettableDataDir(path.join(path.sep, "home"), keep)).toBe(false);
		expect(isResettableDataDir(path.sep, keep)).toBe(false);
		expect(isResettableDataDir("relative/db", keep)).toBe(false);
		expect(isResettableDataDir(path.join(home, "..data"), keep)).toBe(true);
	});
});

describe("daemon failures", () => {
	const daemons = mergeDaemons(
		[],
		[
			{ id: "shop/web" },
			{ id: "shop/api" },
			{ id: "shop/db" },
			{ id: "shop/job" },
		],
		[
			listed("shop/web", "errored", { error: "exit code 1" }),
			listed("shop/api", "errored"),
			listed("shop/db", "stopped"),
			listed("shop/job", "running"),
		],
	);

	it("are the running daemons that errored since", () => {
		const previous = new Map([
			["shop/web", "running"],
			// it was not running: a failed start reports itself
			["shop/api", "available"],
			// stopped on purpose
			["shop/db", "running"],
		]);
		expect(
			newlyFailedDaemons(previous, daemons).map((daemon) => daemon.id),
		).toEqual(["shop/web"]);
		expect(newlyFailedDaemons(new Map(), daemons)).toEqual([]);
	});

	it("are counted in the status bar", () => {
		expect(summarizeDaemons(daemons)).toEqual({
			running: 1,
			failed: 2,
			text: "$(server-process) 1 $(error) 2",
		});
		expect(summarizeDaemons([]).text).toBe("$(server-process) 0");
	});
});
