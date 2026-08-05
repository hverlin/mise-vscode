// Pure helpers for `mise bootstrap status --json`, shared between the
// tree view provider and the webview (must not import vscode)

// states that mean "already in its desired state"
export const BOOTSTRAP_OK_STATES = new Set([
	"installed",
	"applied",
	"set",
	"ok",
	"cloned",
	"loaded",
	"active",
	"linked",
	"enabled",
	"running",
	"up-to-date",
	"up_to_date",
	// declarative resources whose action is `noop`, and secrets that resolved
	"unchanged",
	"available",
]);

// states that are neither converged nor actionable (e.g. wrong OS)
export const BOOTSTRAP_NEUTRAL_STATES = new Set([
	"skipped",
	"unavailable",
	"unsupported",
	// declarative resources mise could not inspect (unsupported platform, a
	// missing secret, docker not running, ...) — nothing for the user to act on
	"unknown",
]);

export type BootstrapDefinition = {
	/** TOML table containing the key, e.g. ["bootstrap", "packages"] */
	tablePath: string[];
	/** key in that table, e.g. "brew:nginx" */
	key: string;
};

export type BootstrapEntry = {
	label: string;
	description?: string;
	tooltip?: string;
	state: string;
	/** where the entry is declared in mise config files */
	definition: BootstrapDefinition;
	/**
	 * other ways the same entry can be declared, e.g. the
	 * `[bootstrap.macos.finder]` shorthand for a `com.apple.finder` default
	 */
	alternates?: BootstrapDefinition[];
};

/**
 * Friendly macOS sections and the `defaults` domain/key they resolve to
 * (`mise bootstrap status` only reports the resolved form).
 * See https://mise.jdx.dev/bootstrap/macos-defaults.html
 */
const MACOS_DEFAULTS_SHORTHANDS: Array<{
	section: string;
	key: string;
	domain: string;
	defaultsKey: string;
}> = [
	{
		section: "dock",
		key: "autohide",
		domain: "com.apple.dock",
		defaultsKey: "autohide",
	},
	{
		section: "dock",
		key: "orientation",
		domain: "com.apple.dock",
		defaultsKey: "orientation",
	},
	{
		section: "dock",
		key: "tilesize",
		domain: "com.apple.dock",
		defaultsKey: "tilesize",
	},
	{
		section: "dock",
		key: "magnification",
		domain: "com.apple.dock",
		defaultsKey: "magnification",
	},
	{
		section: "dock",
		key: "largesize",
		domain: "com.apple.dock",
		defaultsKey: "largesize",
	},
	{
		section: "dock",
		key: "show_recents",
		domain: "com.apple.dock",
		defaultsKey: "show-recents",
	},
	{
		section: "dock",
		key: "mru_spaces",
		domain: "com.apple.dock",
		defaultsKey: "mru-spaces",
	},
	{
		section: "finder",
		key: "show_all_files",
		domain: "com.apple.finder",
		defaultsKey: "AppleShowAllFiles",
	},
	{
		section: "finder",
		key: "show_pathbar",
		domain: "com.apple.finder",
		defaultsKey: "ShowPathbar",
	},
	{
		section: "finder",
		key: "show_status_bar",
		domain: "com.apple.finder",
		defaultsKey: "ShowStatusBar",
	},
	{
		section: "finder",
		key: "show_extensions_warning",
		domain: "com.apple.finder",
		defaultsKey: "FXEnableExtensionChangeWarning",
	},
	{
		section: "finder",
		key: "preferred_view_style",
		domain: "com.apple.finder",
		defaultsKey: "FXPreferredViewStyle",
	},
	{
		section: "keyboard",
		key: "key_repeat",
		domain: "NSGlobalDomain",
		defaultsKey: "KeyRepeat",
	},
	{
		section: "keyboard",
		key: "initial_key_repeat",
		domain: "NSGlobalDomain",
		defaultsKey: "InitialKeyRepeat",
	},
	{
		section: "keyboard",
		key: "press_and_hold",
		domain: "NSGlobalDomain",
		defaultsKey: "ApplePressAndHoldEnabled",
	},
	{
		section: "keyboard",
		key: "fn_state",
		domain: "NSGlobalDomain",
		defaultsKey: "com.apple.keyboard.fnState",
	},
	{
		section: "trackpad",
		key: "tap_to_click",
		domain: "com.apple.AppleMultitouchTrackpad",
		defaultsKey: "Clicking",
	},
	{
		section: "trackpad",
		key: "tap_to_click",
		domain: "com.apple.driver.AppleBluetoothMultitouch.trackpad",
		defaultsKey: "Clicking",
	},
	{
		section: "trackpad",
		key: "three_finger_drag",
		domain: "com.apple.AppleMultitouchTrackpad",
		defaultsKey: "TrackpadThreeFingerDrag",
	},
	{
		section: "trackpad",
		key: "three_finger_drag",
		domain: "com.apple.driver.AppleBluetoothMultitouch.trackpad",
		defaultsKey: "TrackpadThreeFingerDrag",
	},
];

export function getMacosDefaultsShorthandDefinitions(
	domain: string,
	defaultsKey: string,
): BootstrapDefinition[] {
	return MACOS_DEFAULTS_SHORTHANDS.filter(
		(shorthand) =>
			shorthand.domain === domain && shorthand.defaultsKey === defaultsKey,
	).map((shorthand) => ({
		tablePath: ["bootstrap", "macos", shorthand.section],
		key: shorthand.key,
	}));
}

export type BootstrapSection = {
	label: string;
	entries: BootstrapEntry[];
};

/**
 * TOML table each declarative resource kind is declared in.
 * `firewall` is the policy itself (`[bootstrap.linux.firewall]`), so it is
 * keyed from the enclosing `[bootstrap.linux]` table.
 */
const RESOURCE_KIND_TABLE_PATHS: Record<string, string[]> = {
	user: ["bootstrap", "users"],
	group: ["bootstrap", "groups"],
	package: ["bootstrap", "packages"],
	file: ["bootstrap", "files"],
	directory: ["bootstrap", "directories"],
	service: ["bootstrap", "services"],
	firewall: ["bootstrap", "linux"],
	"firewall-rule": ["bootstrap", "linux", "firewall"],
	compose: ["bootstrap", "compose"],
};

/**
 * `mise bootstrap` reports a converged resource as the `noop` action; it is
 * displayed as `unchanged` (matching mise's own table output).
 */
export function bootstrapResourceState(
	action: MiseBootstrapResourceAction,
): string {
	return action === "noop" ? "unchanged" : action;
}

function bootstrapResourceEntry(
	resource: MiseBootstrapResource,
): BootstrapEntry {
	const { kind, name } = resource.id;
	const dependsOn = resource.depends_on
		?.map((dependency) => `${dependency.kind}:${dependency.name}`)
		.join(", ");

	return {
		label: name,
		// mise's own table uses the current state as the detail column
		description: resource.current,
		tooltip: `${kind}: ${name}
Current: ${resource.current}
Desired: ${resource.desired}
Action: ${bootstrapResourceState(resource.action)}${
			dependsOn ? `\nDepends on: ${dependsOn}` : ""
		}`,
		state: bootstrapResourceState(resource.action),
		definition: {
			// the firewall policy is the `firewall` key of `[bootstrap.linux]`,
			// every other kind is keyed by the resource name
			tablePath: RESOURCE_KIND_TABLE_PATHS[kind] ?? ["bootstrap"],
			key: kind === "firewall" ? "firewall" : name,
		},
	};
}

function bootstrapResourceSection(
	label: string,
	resources: MiseBootstrapResource[] | undefined,
): BootstrapSection[] {
	if (!resources?.length) {
		return [];
	}
	return [{ label, entries: resources.map(bootstrapResourceEntry) }];
}

/**
 * Locate a TOML key in raw text — fallback when the structured parser cannot
 * find it (e.g. the file does not fully parse). Prefers quoted occurrences,
 * then bare keys in key position (followed by `=`, `.` or `]`).
 */
export function findKeyInText(
	text: string,
	key: string,
): { line: number; character: number; length: number } | undefined {
	const lines = text.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		for (const quote of ['"', "'"]) {
			const index = line.indexOf(`${quote}${key}${quote}`);
			if (index !== -1) {
				return { line: i, character: index + 1, length: key.length };
			}
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		const index = line.indexOf(key);
		if (index === -1) {
			continue;
		}
		const after = line.slice(index + key.length);
		if (/^\s*[=.\]]/.test(after)) {
			return { line: i, character: index, length: key.length };
		}
	}

	return undefined;
}

export function isBootstrapEntryPending(entry: BootstrapEntry): boolean {
	return (
		!BOOTSTRAP_OK_STATES.has(entry.state) &&
		!BOOTSTRAP_NEUTRAL_STATES.has(entry.state)
	);
}

export function getBootstrapSections(
	status: MiseBootstrapStatus,
): BootstrapSection[] {
	// sections follow the order `mise bootstrap` converges them in
	const sections: BootstrapSection[] = [];

	if (status.secrets?.length) {
		sections.push({
			label: "Secrets",
			entries: status.secrets.map((secret) => ({
				label: secret.name,
				description: secret.env,
				tooltip: `Secret: ${secret.name}
Environment variable: ${secret.env}
State: ${secret.state}${secret.description ? `\n${secret.description}` : ""}`,
				state: secret.state,
				definition: {
					tablePath: ["bootstrap", "secrets"],
					key: secret.name,
				},
			})),
		});
	}

	sections.push(...bootstrapResourceSection("Accounts", status.accounts));

	const packageEntries = Object.entries(status.packages ?? {}).flatMap(
		([manager, info]) =>
			info.packages.map((pkg) => ({
				label: `${manager}:${pkg.package}`,
				description: pkg.installed_version || pkg.requested_version,
				tooltip: `Package: ${manager}:${pkg.package}
Requested version: ${pkg.requested_version}
Installed version: ${pkg.installed_version || "-"}
State: ${pkg.state}`,
				state: info.available ? pkg.state : "unavailable",
				definition: {
					tablePath: ["bootstrap", "packages"],
					key: `${manager}:${pkg.package}`,
				},
			})),
	);
	if (packageEntries.length > 0) {
		sections.push({ label: "Packages", entries: packageEntries });
	}

	sections.push(
		...bootstrapResourceSection("Files", status.files),
		...bootstrapResourceSection("Services", status.services),
		...bootstrapResourceSection("Firewall", status.firewall),
		...bootstrapResourceSection("Compose", status.compose),
	);

	if (status.repos?.length) {
		sections.push({
			label: "Repos",
			entries: status.repos.map((repo) => ({
				label: repo.path_raw,
				description: [repo.ref, repo.state].filter(Boolean).join(" "),
				tooltip: `Repo: ${repo.url}
Path: ${repo.path}
Ref: ${repo.ref ?? "-"}
Current ref: ${repo.current_ref ?? "-"}
State: ${repo.state}${repo.reason ? `\nReason: ${repo.reason}` : ""}`,
				state: repo.state,
				definition: {
					tablePath: ["bootstrap", "repos"],
					key: repo.path_raw,
				},
			})),
		});
	}

	const dotfiles = [
		...(status.dotfiles?.files ?? []),
		...(status.dotfiles?.edits ?? []),
	];
	if (dotfiles.length > 0) {
		sections.push({
			label: "Dotfiles",
			entries: dotfiles.map((dotfile) => ({
				label: dotfile.target,
				description: [dotfile.mode, dotfile.state].filter(Boolean).join(" "),
				tooltip: `Target: ${dotfile.target}
Source: ${dotfile.source}
Mode: ${dotfile.mode}
State: ${dotfile.state}`,
				state: dotfile.state,
				definition: {
					tablePath: ["dotfiles"],
					key: dotfile.target,
				},
			})),
		});
	}

	if (status.mise_shell_activate?.length) {
		sections.push({
			label: "Shell Activation",
			entries: status.mise_shell_activate.map((activation) => ({
				label: activation.path,
				description: [activation.mode, activation.state]
					.filter(Boolean)
					.join(" "),
				tooltip: `Shell: ${activation.shell}
File: ${activation.path}
Mode: ${activation.mode}
State: ${activation.state}`,
				state: activation.state,
				definition: {
					tablePath: ["bootstrap", "mise_shell_activate"],
					key: activation.target,
				},
			})),
		});
	}

	if (status.macos_defaults?.entries?.length) {
		sections.push({
			label: "macOS Defaults",
			entries: status.macos_defaults.entries.map((entry) => ({
				label: `${entry.domain} ${entry.key}`,
				description: entry.state,
				tooltip: `Domain: ${entry.domain}
Key: ${entry.key}
Wanted: ${JSON.stringify(entry.value)}
Current: ${entry.current ?? "-"}
State: ${entry.state}`,
				state:
					status.macos_defaults.available === false
						? "unavailable"
						: entry.state,
				definition: {
					tablePath: ["bootstrap", "macos", "defaults", entry.domain],
					key: entry.key,
				},
				alternates: getMacosDefaultsShorthandDefinitions(
					entry.domain,
					entry.key,
				),
			})),
		});
	}

	if (status.launchd?.agents?.length) {
		sections.push({
			label: "Launchd Agents",
			entries: status.launchd.agents.map((agent) => ({
				label: agent.name,
				description: agent.state,
				tooltip: `Agent: ${agent.label}
Plist: ${agent.path}
Loaded: ${agent.loaded}
State: ${agent.state}`,
				state: status.launchd.available === false ? "unavailable" : agent.state,
				definition: {
					tablePath: ["bootstrap", "macos", "launchd", "agents"],
					key: agent.name,
				},
			})),
		});
	}

	if (status.systemd?.units?.length) {
		sections.push({
			label: "Systemd Units",
			entries: status.systemd.units.map((unit) => ({
				label: unit.name,
				description: unit.state,
				tooltip: `Unit: ${unit.unit}
State: ${unit.state}${status.systemd.reason ? `\n(${status.systemd.reason})` : ""}`,
				state: status.systemd.available === false ? "unavailable" : unit.state,
				definition: {
					tablePath: ["bootstrap", "linux", "systemd", "units"],
					key: unit.name,
				},
			})),
		});
	}

	if (status.login_shell) {
		const loginShell = status.login_shell;
		sections.push({
			label: "Login Shell",
			entries: [
				{
					label: loginShell.shell,
					description: loginShell.state,
					tooltip: `Wanted: ${loginShell.shell}
Current: ${loginShell.current ?? "-"}
User: ${loginShell.user}
State: ${loginShell.available ? loginShell.state : "unavailable"}`,
					state: loginShell.available ? loginShell.state : "unavailable",
					definition: {
						tablePath: ["bootstrap", "user"],
						key: "login_shell",
					},
				},
			],
		});
	}

	return sections;
}
