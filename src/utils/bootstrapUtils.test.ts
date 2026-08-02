import { describe, expect, test } from "bun:test";
import {
	BOOTSTRAP_NEUTRAL_STATES,
	BOOTSTRAP_OK_STATES,
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
