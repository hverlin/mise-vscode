import * as vscode from "vscode";
import {
	MISE_RESTART_DAEMON,
	MISE_SHOW_DAEMON_LOGS,
	MISE_START_DAEMON,
	MISE_STOP_DAEMON,
} from "../commands";
import { isMiseExtensionEnabled } from "../configuration";
import { findKeyInTomlDocument } from "../utils/bootstrapDocument";
import {
	type Daemon,
	declaredDaemonNames,
	describeDaemon,
	isDaemonActive,
	isPitchforkConfigPath,
	isSamePath,
} from "../utils/daemons";
import { expandPath } from "../utils/fileUtils";
import { getCachedTomlParser } from "../utils/miseFileParser";
import { isMiseConfigPath } from "../utils/miseUtilts";
import {
	type DaemonNameContext,
	getDaemonNameAt,
	getDaemonNameValueContext,
} from "../utils/tomlParsing";
import {
	daemonTooltip,
	findDaemonDefinition,
	type MiseDaemonsProvider,
} from "./daemonsProvider";

/** The service presets of mise, see https://mise.jdx.dev/daemons/presets.html */
const PRESETS = [
	{ name: "postgres", title: "PostgreSQL" },
	{ name: "redis", title: "Redis" },
	{ name: "cockroachdb", title: "CockroachDB" },
	{ name: "nats", title: "NATS" },
	{ name: "spicedb", title: "SpiceDB" },
];

const presetDocs = (title: string) =>
	`https://mise.jdx.dev/daemons/presets.html#${title.toLowerCase()}`;

type DaemonNames = {
	/** each daemon, with what the Daemons view knows about it */
	daemons: Map<string, Daemon | undefined>;
	/** each group of the document, with its members */
	groups: Map<string, string[]>;
};

/**
 * The daemons a config can name: the ones it declares, and the ones of the
 * Daemons view from the same kind of config (mise configs name mise daemons,
 * pitchfork configs pitchfork ones). `undefined` for any other TOML file.
 */
function daemonNamesOf(
	document: vscode.TextDocument,
	provider: MiseDaemonsProvider,
): DaemonNames | undefined {
	const filePath = document.uri.fsPath;
	const isPitchfork = isPitchforkConfigPath(filePath);
	if (
		!isMiseExtensionEnabled() ||
		(!isPitchfork && !isMiseConfigPath(filePath))
	) {
		return undefined;
	}

	const parsed = getCachedTomlParser(document)?.parsed as
		| { daemon_groups?: Record<string, unknown> }
		| undefined;
	const daemons = new Map<string, Daemon | undefined>(
		declaredDaemonNames(parsed).map((name) => [name, undefined]),
	);
	for (const daemon of provider.state?.daemons ?? []) {
		if (daemon.kind !== (isPitchfork ? "pitchfork" : "mise")) {
			continue;
		}
		// the one this file declares over the same name elsewhere
		const known = daemons.get(daemon.name);
		if (
			!known ||
			(daemon.source && isSamePath(expandPath(daemon.source), filePath))
		) {
			daemons.set(daemon.name, daemon);
		}
	}

	const groups = new Map<string, string[]>();
	for (const [name, value] of Object.entries(parsed?.daemon_groups ?? {})) {
		const members = Array.isArray(value)
			? value
			: (value as { daemons?: unknown } | undefined)?.daemons;
		groups.set(
			name,
			Array.isArray(members)
				? members.filter(
						(member): member is string => typeof member === "string",
					)
				: [],
		);
	}
	return { daemons, groups };
}

/** A daemon by the name a value gives it: its name, or its `namespace/name` id */
function findNamed(
	names: DaemonNames,
	name: string,
	provider: MiseDaemonsProvider,
): { known: boolean; daemon?: Daemon } {
	if (names.daemons.has(name)) {
		return { known: true, daemon: names.daemons.get(name) };
	}
	const daemon = provider.state?.daemons.find((daemon) => daemon.id === name);
	return { known: !!daemon, daemon };
}

/** The range of the name being typed, from its opening quote */
function typedRange(
	document: vscode.TextDocument,
	position: vscode.Position,
	context: DaemonNameContext,
): vscode.Range | undefined {
	if (!context.inQuote) {
		return undefined;
	}
	const prefix = document
		.lineAt(position.line)
		.text.slice(0, position.character);
	const quote = Math.max(prefix.lastIndexOf('"'), prefix.lastIndexOf("'"));
	return new vscode.Range(
		position.line,
		quote + 1,
		position.line,
		position.character,
	);
}

/**
 * Completes the daemon names of a task's `daemons`, a daemon's `depends` and
 * the members of a `[daemon_groups]` group, and the `preset` of a daemon.
 */
export class DaemonNameCompletionProvider
	implements vscode.CompletionItemProvider
{
	constructor(private provider: MiseDaemonsProvider) {}

	provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): vscode.CompletionItem[] | undefined {
		const context = getDaemonNameValueContext(document, position);
		if (!context) {
			return undefined;
		}
		const names = daemonNamesOf(document, this.provider);
		if (!names) {
			return undefined;
		}
		const range = typedRange(document, position, context);
		const item = (
			label: string,
			kind: vscode.CompletionItemKind,
			detail: string,
			order: number,
		) => {
			const completion = new vscode.CompletionItem(label, kind);
			completion.insertText = context.inQuote ? label : `"${label}"`;
			completion.detail = detail;
			completion.range = range;
			completion.sortText = `${order}${label}`;
			return completion;
		};

		if (context.accepts === "presets") {
			// presets are mise's own
			if (isPitchforkConfigPath(document.uri.fsPath)) {
				return undefined;
			}
			return PRESETS.map(({ name, title }) => {
				const completion = item(
					name,
					vscode.CompletionItemKind.EnumMember,
					`${title} preset`,
					0,
				);
				completion.documentation = new vscode.MarkdownString(
					`[${title} preset](${presetDocs(title)})`,
				);
				return completion;
			});
		}

		const items: vscode.CompletionItem[] = [];
		for (const [name, daemon] of names.daemons) {
			if (name === context.owner && context.accepts === "daemons") {
				continue;
			}
			const completion = item(
				name,
				vscode.CompletionItemKind.Value,
				daemon ? `daemon · ${describeDaemon(daemon)}` : "daemon",
				0,
			);
			if (daemon) {
				completion.documentation = daemonTooltip(daemon);
			}
			items.push(completion);
		}
		if (context.accepts === "daemonsAndGroups") {
			for (const [name, members] of names.groups) {
				if (name !== context.owner) {
					items.push(
						item(
							name,
							vscode.CompletionItemKind.Module,
							`daemon group: ${members.join(", ")}`,
							1,
						),
					);
				}
			}
		}
		return items;
	}
}

/** Goes from a daemon or group name to where it is declared */
export class DaemonNameDefinitionProvider implements vscode.DefinitionProvider {
	constructor(
		private provider: MiseDaemonsProvider,
		private folder: () => string | undefined,
	) {}

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.LocationLink[] | undefined> {
		const at = getDaemonNameAt(document, position);
		const names = at && daemonNamesOf(document, this.provider);
		if (!at || !names || at.context.accepts === "presets") {
			return undefined;
		}
		const originSelectionRange = new vscode.Range(
			position.line,
			at.start,
			position.line,
			at.end,
		);
		const link = (location: vscode.Location): vscode.LocationLink[] => [
			{
				originSelectionRange,
				targetUri: location.uri,
				targetRange: location.range,
			},
		];

		const group =
			at.context.accepts === "daemonsAndGroups"
				? findKeyInTomlDocument(document, ["daemon_groups"], at.name)
				: undefined;
		if (group) {
			return link(new vscode.Location(document.uri, group));
		}
		// declared here, even before the Daemons view knows about it
		const local = findKeyInTomlDocument(document, ["daemons"], at.name);
		if (local) {
			return link(new vscode.Location(document.uri, local));
		}
		const { daemon } = findNamed(names, at.name, this.provider);
		const location = daemon
			? await findDaemonDefinition(daemon, this.folder())
			: undefined;
		return location ? link(location) : undefined;
	}
}

/** What a daemon, group or preset name stands for, with actions on a daemon */
export class DaemonNameHoverProvider implements vscode.HoverProvider {
	constructor(private provider: MiseDaemonsProvider) {}

	provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
	): vscode.Hover | undefined {
		const at = getDaemonNameAt(document, position);
		const names = at && daemonNamesOf(document, this.provider);
		if (!at || !names) {
			return undefined;
		}
		const range = new vscode.Range(
			position.line,
			at.start,
			position.line,
			at.end,
		);

		if (at.context.accepts === "presets") {
			const preset = PRESETS.find((preset) => preset.name === at.name);
			return preset
				? new vscode.Hover(
						new vscode.MarkdownString(
							`**${preset.title}** service preset of mise\n\n[Preset options](${presetDocs(preset.title)})`,
						),
						range,
					)
				: undefined;
		}

		const members =
			at.context.accepts === "daemonsAndGroups"
				? names.groups.get(at.name)
				: undefined;
		if (members) {
			return new vscode.Hover(
				new vscode.MarkdownString(
					`**${at.name}** daemon group: ${members.map((member) => `\`${member}\``).join(", ")}`,
				),
				range,
			);
		}

		const { known, daemon } = findNamed(names, at.name, this.provider);
		if (!known) {
			return undefined;
		}
		if (!daemon) {
			return new vscode.Hover(
				new vscode.MarkdownString(
					`**${at.name}** daemon, declared in this file`,
				),
				range,
			);
		}

		const markdown = daemonTooltip(daemon);
		const action = (title: string, command: string) =>
			`[${title}](command:${command}?${encodeURIComponent(JSON.stringify([daemon]))})`;
		const actions = isDaemonActive(daemon)
			? [
					action("Stop", MISE_STOP_DAEMON),
					action("Restart", MISE_RESTART_DAEMON),
				]
			: [action("Start", MISE_START_DAEMON)];
		actions.push(action("Logs", MISE_SHOW_DAEMON_LOGS));
		markdown.appendMarkdown(`\n\n${actions.join(" · ")}`);
		markdown.isTrusted = {
			enabledCommands: [
				MISE_START_DAEMON,
				MISE_STOP_DAEMON,
				MISE_RESTART_DAEMON,
				MISE_SHOW_DAEMON_LOGS,
			],
		};
		return new vscode.Hover(markdown, range);
	}
}
