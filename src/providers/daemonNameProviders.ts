import path from "node:path";
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
	pitchforkNamespace,
} from "../utils/daemons";
import { expandPath, isPathInside } from "../utils/fileUtils";
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

/** The members of a group, as mise or pitchfork declare it */
function groupsOf(
	parsed: unknown,
	isPitchfork: boolean,
): Map<string, string[]> {
	const strings = (value: unknown) =>
		Array.isArray(value)
			? value.filter((member): member is string => typeof member === "string")
			: [];
	const groups = new Map<string, string[]>();
	if (isPitchfork) {
		// `[groups.all]` with `daemons = [...]` and `groups = [...]`
		const table = (parsed as { groups?: Record<string, unknown> } | undefined)
			?.groups;
		for (const [name, value] of Object.entries(table ?? {})) {
			const group = value as
				| { daemons?: unknown; groups?: unknown }
				| undefined;
			groups.set(name, [...strings(group?.daemons), ...strings(group?.groups)]);
		}
		return groups;
	}
	// `name = [...]`, or `[daemon_groups.name]` with `daemons = [...]`
	const table = (
		parsed as { daemon_groups?: Record<string, unknown> } | undefined
	)?.daemon_groups;
	for (const [name, value] of Object.entries(table ?? {})) {
		groups.set(
			name,
			strings(
				Array.isArray(value)
					? value
					: (value as { daemons?: unknown } | undefined)?.daemons,
			),
		);
	}
	return groups;
}

/**
 * The daemons a config can name: the ones it declares, and the ones of the
 * Daemons view that apply to it: for a mise config, those of its project and
 * of the configs above it, and for a pitchfork config, those of its
 * namespace. A daemon declared in the file is only matched with itself, never
 * with a same-named one from elsewhere. `undefined` for any other TOML file,
 * and for a value that means nothing in this kind of config.
 */
function daemonNamesOf(
	document: vscode.TextDocument,
	provider: MiseDaemonsProvider,
	context?: DaemonNameContext,
): DaemonNames | undefined {
	const filePath = document.uri.fsPath;
	const isPitchfork = isPitchforkConfigPath(filePath);
	if (
		!isMiseExtensionEnabled() ||
		(!isPitchfork && !isMiseConfigPath(filePath)) ||
		(context &&
			context.syntax !== "any" &&
			(context.syntax === "pitchfork") !== isPitchfork)
	) {
		return undefined;
	}

	const parsed = getCachedTomlParser(document)?.parsed;
	const declared = declaredDaemonNames(parsed);
	const daemons = new Map<string, Daemon | undefined>(
		declared.map((name) => [name, undefined]),
	);
	const namespace = isPitchfork
		? pitchforkNamespace(filePath, parsed)
		: undefined;
	const directory = path.dirname(filePath);
	for (const daemon of provider.state?.daemons ?? []) {
		const declaredHere = isPitchfork
			? daemon.kind === "pitchfork" && daemon.namespace === namespace
			: daemon.kind === "mise" &&
				!!daemon.source &&
				isSamePath(expandPath(daemon.source), filePath);
		const appliesHere =
			declaredHere ||
			(!isPitchfork &&
				daemon.kind === "mise" &&
				!!daemon.root &&
				(isSamePath(daemon.root, directory) ||
					isPathInside(expandPath(daemon.root), directory)));
		if (declared.includes(daemon.name) ? declaredHere : appliesHere) {
			daemons.set(daemon.name, daemon);
		}
	}
	return { daemons, groups: groupsOf(parsed, isPitchfork) };
}

/** Where a config declares its groups: `[groups]` for pitchfork */
const groupsTable = (document: vscode.TextDocument) =>
	isPitchforkConfigPath(document.uri.fsPath) ? "groups" : "daemon_groups";

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
		const names = daemonNamesOf(document, this.provider, context);
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
			if (
				context.accepts === "groups" ||
				(name === context.owner && context.accepts === "daemons")
			) {
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
		if (context.accepts !== "daemons") {
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
		const names = at && daemonNamesOf(document, this.provider, at.context);
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
			at.context.accepts === "daemons"
				? undefined
				: findKeyInTomlDocument(document, [groupsTable(document)], at.name);
		if (group) {
			return link(new vscode.Location(document.uri, group));
		}
		if (at.context.accepts === "groups") {
			return undefined;
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
		const names = at && daemonNamesOf(document, this.provider, at.context);
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
			at.context.accepts === "daemons" ? undefined : names.groups.get(at.name);
		if (members) {
			return new vscode.Hover(
				new vscode.MarkdownString(
					`**${at.name}** daemon group: ${members.map((member) => `\`${member}\``).join(", ")}`,
				),
				range,
			);
		}

		const { known, daemon } = findNamed(names, at.name, this.provider);
		if (!known || at.context.accepts === "groups") {
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

		const action = (title: string, command: string) =>
			`[${title}](command:${command}?${encodeURIComponent(JSON.stringify([daemon]))})`;
		const actions = isDaemonActive(daemon)
			? [
					action("Stop", MISE_STOP_DAEMON),
					action("Restart", MISE_RESTART_DAEMON),
				]
			: [action("Start", MISE_START_DAEMON)];
		actions.push(action("Logs", MISE_SHOW_DAEMON_LOGS));
		// only the actions are trusted: the status comes from pitchfork, e.g. the
		// error message of a daemon, and may hold anything
		const trusted = new vscode.MarkdownString(actions.join(" · "));
		trusted.isTrusted = {
			enabledCommands: [
				MISE_START_DAEMON,
				MISE_STOP_DAEMON,
				MISE_RESTART_DAEMON,
				MISE_SHOW_DAEMON_LOGS,
			],
		};
		return new vscode.Hover([daemonTooltip(daemon), trusted], range);
	}
}
