import { describe, expect, test } from "bun:test";
import {
	BOOTSTRAP_NEUTRAL_STATES,
	BOOTSTRAP_OK_STATES,
	bootstrapResourceState,
	findKeyInText,
	getBootstrapSections,
	getMacosDefaultsShorthandDefinitions,
} from "./bootstrapUtils";

// captured from `mise bootstrap status --json` (mise 2026.7.18)
const status: MiseBootstrapStatus = {
	packages: {
		brew: {
			available: true,
			packages: [
				{
					package: "jq",
					requested_version: "latest",
					state: "installed",
					installed_version: "1.8.2",
				},
				{
					package: "missing-package",
					requested_version: "latest",
					state: "missing",
					installed_version: "",
				},
			],
		},
	},
	repos: [
		{
			path: "/Users/me/src/test-repo",
			path_raw: "~/src/test-repo",
			url: "https://github.com/jdx/mise.git",
			ref: "main",
			origin: null,
			current_ref: null,
			current_sha: null,
			state: "missing",
			reason: "",
		},
	],
	dotfiles: {
		files: [
			{
				target: "~/.gitconfig",
				source: "~/.dotfiles/.gitconfig",
				mode: "symlink",
				state: "applied",
			},
		],
		edits: [],
	},
	mise_shell_activate: [
		{
			target: "zshrc",
			shell: "zsh",
			path: "~/.zshrc",
			mode: "activate",
			state: "missing",
		},
	],
	macos_defaults: {
		available: true,
		entries: [
			{
				domain: "com.apple.finder",
				key: "AppleShowAllFiles",
				value: true,
				current: "0",
				state: "differs",
			},
		],
	},
	launchd: {
		available: true,
		agents: [
			{
				name: "my-agent",
				label: "dev.mise.my-agent",
				path: "/Users/me/Library/LaunchAgents/dev.mise.my-agent.plist",
				loaded: false,
				state: "missing",
			},
		],
	},
	systemd: {
		available: false,
		reason: "only available on linux",
		units: [
			{ name: "my-unit", unit: "dev.mise.my-unit.service", state: "skipped" },
		],
	},
	login_shell: {
		available: true,
		shell: "/bin/zsh",
		user: "me",
		current: "/bin/zsh",
		shell_listed: true,
		state: "set",
	},
	tools: [
		{
			tool: "node",
			requested_version: "24",
			resolved_version: "24.14.1",
			state: "installed",
			installed: true,
		},
	],
};

describe("getBootstrapSections", () => {
	test("builds one section per configured bootstrap area", () => {
		const sections = getBootstrapSections(status);

		expect(sections.map((section) => section.label)).toEqual([
			"Packages",
			"Repos",
			"Dotfiles",
			"Shell Activation",
			"macOS Defaults",
			"Launchd Agents",
			"Systemd Units",
			"Login Shell",
		]);
	});

	test("skips empty sections", () => {
		const sections = getBootstrapSections({
			...status,
			packages: {},
			repos: [],
			dotfiles: { files: [], edits: [] },
			mise_shell_activate: [],
			macos_defaults: { available: true, entries: [] },
			launchd: { available: true, agents: [] },
			systemd: { available: false, units: [] },
			login_shell: null,
		});

		expect(sections).toEqual([]);
	});

	test("flattens packages across managers with their state", () => {
		const packages = getBootstrapSections(status).find(
			(section) => section.label === "Packages",
		);

		expect(packages?.entries).toHaveLength(2);
		expect(packages?.entries[0]?.label).toBe("brew:jq");
		expect(packages?.entries[0]?.state).toBe("installed");
		expect(packages?.entries[1]?.state).toBe("missing");
	});

	test("marks entries as unavailable when the section is unavailable", () => {
		const systemd = getBootstrapSections(status).find(
			(section) => section.label === "Systemd Units",
		);

		expect(systemd?.entries[0]?.state).toBe("unavailable");
		expect(BOOTSTRAP_NEUTRAL_STATES.has("unavailable")).toBe(true);
	});

	test("entries point to their declaration in mise config files", () => {
		const sections = getBootstrapSections(status);
		const byLabel = (label: string) =>
			sections.find((section) => section.label === label);

		expect(byLabel("Packages")?.entries[0]?.definition).toEqual({
			tablePath: ["bootstrap", "packages"],
			key: "brew:jq",
		});
		expect(byLabel("Repos")?.entries[0]?.definition).toEqual({
			tablePath: ["bootstrap", "repos"],
			key: "~/src/test-repo",
		});
		expect(byLabel("Dotfiles")?.entries[0]?.definition).toEqual({
			tablePath: ["dotfiles"],
			key: "~/.gitconfig",
		});
		expect(byLabel("Shell Activation")?.entries[0]?.definition).toEqual({
			tablePath: ["bootstrap", "mise_shell_activate"],
			key: "zshrc",
		});
		expect(byLabel("macOS Defaults")?.entries[0]?.definition).toEqual({
			tablePath: ["bootstrap", "macos", "defaults", "com.apple.finder"],
			key: "AppleShowAllFiles",
		});
		expect(byLabel("Launchd Agents")?.entries[0]?.definition).toEqual({
			tablePath: ["bootstrap", "macos", "launchd", "agents"],
			key: "my-agent",
		});
		expect(byLabel("Systemd Units")?.entries[0]?.definition).toEqual({
			tablePath: ["bootstrap", "linux", "systemd", "units"],
			key: "my-unit",
		});
		expect(byLabel("Login Shell")?.entries[0]?.definition).toEqual({
			tablePath: ["bootstrap", "user"],
			key: "login_shell",
		});
	});

	test("macOS defaults entries carry their shorthand declarations", () => {
		// [bootstrap.macos.finder] show_pathbar resolves to
		// com.apple.finder ShowPathbar in `mise bootstrap status`
		expect(
			getMacosDefaultsShorthandDefinitions("com.apple.finder", "ShowPathbar"),
		).toEqual([
			{ tablePath: ["bootstrap", "macos", "finder"], key: "show_pathbar" },
		]);

		expect(
			getMacosDefaultsShorthandDefinitions("NSGlobalDomain", "KeyRepeat"),
		).toEqual([
			{ tablePath: ["bootstrap", "macos", "keyboard"], key: "key_repeat" },
		]);

		// trackpad shorthands write to two domains; both resolve back
		expect(
			getMacosDefaultsShorthandDefinitions(
				"com.apple.AppleMultitouchTrackpad",
				"Clicking",
			),
		).toEqual([
			{ tablePath: ["bootstrap", "macos", "trackpad"], key: "tap_to_click" },
		]);

		// raw defaults have no shorthand
		expect(
			getMacosDefaultsShorthandDefinitions("com.example.app", "SomeKey"),
		).toEqual([]);

		const sections = getBootstrapSections({
			...status,
			macos_defaults: {
				available: true,
				entries: [
					{
						domain: "com.apple.finder",
						key: "ShowPathbar",
						value: true,
						current: "",
						state: "unset",
					},
				],
			},
		});
		const defaults = sections.find(
			(section) => section.label === "macOS Defaults",
		);
		expect(defaults?.entries[0]?.alternates).toEqual([
			{ tablePath: ["bootstrap", "macos", "finder"], key: "show_pathbar" },
		]);
	});

	test("findKeyInText finds quoted keys", () => {
		const text = `[bootstrap.macos.defaults]
"com.apple.finder" = { ShowPathbar = true }`;

		expect(findKeyInText(text, "com.apple.finder")).toEqual({
			line: 1,
			character: 1,
			length: "com.apple.finder".length,
		});
	});

	test("findKeyInText finds bare keys in key position only", () => {
		const text = `# ShowPathbar is described here but not declared
[bootstrap.macos.defaults."com.apple.finder"]
ShowPathbar = true`;

		expect(findKeyInText(text, "ShowPathbar")).toEqual({
			line: 2,
			character: 0,
			length: "ShowPathbar".length,
		});
		expect(findKeyInText(text, "NotDeclared")).toBeUndefined();
	});

	test("state sets classify the observed mise states", () => {
		expect(BOOTSTRAP_OK_STATES.has("installed")).toBe(true);
		expect(BOOTSTRAP_OK_STATES.has("applied")).toBe(true);
		expect(BOOTSTRAP_OK_STATES.has("set")).toBe(true);
		expect(BOOTSTRAP_OK_STATES.has("missing")).toBe(false);
		expect(BOOTSTRAP_OK_STATES.has("differs")).toBe(false);
		expect(BOOTSTRAP_NEUTRAL_STATES.has("skipped")).toBe(true);
	});
});

// `mise bootstrap status --json` gained declarative provisioning sections in
// mise 2026.8.2; the payloads below are captured from that version
describe("getBootstrapSections (declarative resources)", () => {
	const resourceStatus: MiseBootstrapStatus = {
		...status,
		packages: {},
		repos: [],
		dotfiles: { files: [], edits: [] },
		mise_shell_activate: [],
		macos_defaults: { available: true, entries: [] },
		launchd: { available: true, agents: [] },
		systemd: { available: false, units: [] },
		login_shell: null,
		tools: [],
		secrets: [
			{ name: "cache_token", env: "MISE_CACHE_TOKEN", state: "available" },
			{
				name: "db_password",
				env: "DEMO_DB_PASSWORD",
				state: "missing",
				description: "Demo database password",
			},
		],
		accounts: [
			{
				id: { kind: "group", name: "docker" },
				current: "absent",
				desired: "present",
				action: "create",
			},
			{
				id: { kind: "user", name: "deploy" },
				current: "absent",
				desired: "present; groups docker",
				action: "create",
				depends_on: [{ kind: "group", name: "docker" }],
			},
		],
		files: [
			{
				id: { kind: "directory", name: "/etc/example" },
				current: "directory mode 0755 uid 0 gid 0",
				desired: "directory mode 0755",
				action: "noop",
			},
			{
				id: { kind: "file", name: "/etc/example/app.conf" },
				current: "absent",
				desired: "file mode 0644",
				action: "create",
			},
		],
		services: [
			{
				id: { kind: "service", name: "nginx" },
				current: "running; enabled",
				desired: "running; enabled",
				action: "noop",
			},
		],
		firewall: [
			{
				id: { kind: "firewall-rule", name: "ssh" },
				current: "absent",
				desired: "accept tcp/22",
				action: "create",
			},
			{
				id: { kind: "firewall", name: "linux" },
				current: "unsupported platform",
				desired: "configured Linux firewall",
				action: "unknown",
			},
		],
		compose: [
			{
				id: { kind: "compose", name: "web" },
				current: "stopped",
				desired: "running; pull missing; build auto",
				action: "update",
			},
		],
	};

	test("adds one section per declarative area, in converge order", () => {
		expect(getBootstrapSections(resourceStatus).map((s) => s.label)).toEqual([
			"Secrets",
			"Accounts",
			"Files",
			"Services",
			"Firewall",
			"Compose",
		]);
	});

	test("omits declarative sections that mise did not report", () => {
		// status from a mise older than 2026.8.2 has none of these keys
		expect(
			getBootstrapSections({
				...resourceStatus,
				secrets: undefined,
				accounts: undefined,
				files: undefined,
				services: undefined,
				firewall: undefined,
				compose: undefined,
			}),
		).toEqual([]);
		expect(
			getBootstrapSections({ ...resourceStatus, files: [] }).map(
				(s) => s.label,
			),
		).not.toContain("Files");
	});

	test("maps the resource action to a state the icons understand", () => {
		expect(bootstrapResourceState("noop")).toBe("unchanged");
		expect(bootstrapResourceState("create")).toBe("create");

		const byLabel = (label: string) =>
			getBootstrapSections(resourceStatus).find((s) => s.label === label);

		// converged resources read as ok, changes are actionable, and anything
		// mise could not inspect (wrong OS, docker down) is neutral
		expect(byLabel("Files")?.entries[0]?.state).toBe("unchanged");
		expect(BOOTSTRAP_OK_STATES.has("unchanged")).toBe(true);
		expect(byLabel("Files")?.entries[1]?.state).toBe("create");
		expect(BOOTSTRAP_OK_STATES.has("create")).toBe(false);
		expect(BOOTSTRAP_NEUTRAL_STATES.has("create")).toBe(false);
		expect(byLabel("Firewall")?.entries[1]?.state).toBe("unknown");
		expect(BOOTSTRAP_NEUTRAL_STATES.has("unknown")).toBe(true);
		expect(byLabel("Compose")?.entries[0]?.state).toBe("update");
	});

	test("secrets are listed by name with the env var they read, never a value", () => {
		const secrets = getBootstrapSections(resourceStatus).find(
			(s) => s.label === "Secrets",
		);

		expect(secrets?.entries[0]?.label).toBe("cache_token");
		expect(secrets?.entries[0]?.description).toBe("MISE_CACHE_TOKEN");
		expect(secrets?.entries[0]?.state).toBe("available");
		expect(BOOTSTRAP_OK_STATES.has("available")).toBe(true);
		expect(secrets?.entries[1]?.state).toBe("missing");
		expect(secrets?.entries[1]?.tooltip).toContain("Demo database password");
		expect(secrets?.entries[0]?.definition).toEqual({
			tablePath: ["bootstrap", "secrets"],
			key: "cache_token",
		});
	});

	test("each resource kind points at the table it is declared in", () => {
		const sections = getBootstrapSections(resourceStatus);
		const definitions = Object.fromEntries(
			sections.flatMap((section) =>
				section.entries.map((entry) => [entry.label, entry.definition]),
			),
		);

		expect(definitions.docker).toEqual({
			tablePath: ["bootstrap", "groups"],
			key: "docker",
		});
		expect(definitions.deploy).toEqual({
			tablePath: ["bootstrap", "users"],
			key: "deploy",
		});
		expect(definitions["/etc/example"]).toEqual({
			tablePath: ["bootstrap", "directories"],
			key: "/etc/example",
		});
		expect(definitions["/etc/example/app.conf"]).toEqual({
			tablePath: ["bootstrap", "files"],
			key: "/etc/example/app.conf",
		});
		expect(definitions.nginx).toEqual({
			tablePath: ["bootstrap", "services"],
			key: "nginx",
		});
		expect(definitions.ssh).toEqual({
			tablePath: ["bootstrap", "linux", "firewall"],
			key: "ssh",
		});
		// the policy itself is the `firewall` key of [bootstrap.linux], not a
		// resource named after the platform it reports
		expect(definitions.linux).toEqual({
			tablePath: ["bootstrap", "linux"],
			key: "firewall",
		});
		expect(definitions.web).toEqual({
			tablePath: ["bootstrap", "compose"],
			key: "web",
		});
	});

	test("resource tooltips carry current, desired and dependencies", () => {
		const accounts = getBootstrapSections(resourceStatus).find(
			(s) => s.label === "Accounts",
		);

		expect(accounts?.entries[1]?.description).toBe("absent");
		expect(accounts?.entries[1]?.tooltip).toBe(
			`user: deploy
Current: absent
Desired: present; groups docker
Action: create
Depends on: group:docker`,
		);
		// resources without dependencies do not get an empty line
		expect(accounts?.entries[0]?.tooltip).not.toContain("Depends on");
	});
});
