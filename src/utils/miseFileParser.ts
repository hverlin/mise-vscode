import { parse, SourceTracker } from "toml-v1";
import * as vscode from "vscode";
import { logger } from "./logger";
import { isToolVersionsFile, TOOLS_MAPPING } from "./miseUtilts";
import { getTaskDefinitionNameCandidates } from "./taskNames";

export type MiseTomlType = {
	tools?: Record<string, string | object>;
	tasks?: Record<string, string | object>;
	env?: Record<string, string>;
};

interface SourcePosition {
	line: number; // 0-based
	character: number; // 0-based
}

interface KeyPosition {
	keyStart: SourcePosition;
	keyEnd: SourcePosition;
	valueStart: SourcePosition;
	valueEnd: SourcePosition;
	key: string[];
	value?: unknown;
}

// TODO: implement a better parser
export class TomlParser<T extends object> {
	public sourceTracker: SourceTracker;
	public parsed: T;
	private positionMap: KeyPosition[] = [];
	// offsets of every `\n` in the source, for O(log n) offset→position lookups
	private newlineOffsets: number[] = [];

	constructor(source: string) {
		for (
			let i = source.indexOf("\n");
			i !== -1;
			i = source.indexOf("\n", i + 1)
		) {
			this.newlineOffsets.push(i);
		}
		this.sourceTracker = new SourceTracker();
		this.parsed = parse(source, "", this.sourceTracker);

		this.buildPositionMap(this.sourceTracker, this.parsed);
	}

	/** Number of newlines at source indices strictly before `offset` */
	private countNewlinesBefore(offset: number): number {
		let low = 0;
		let high = this.newlineOffsets.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			const newlineOffset = this.newlineOffsets[mid];
			if (newlineOffset !== undefined && newlineOffset < offset) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		return low;
	}

	private offsetToPositionFromLineStart(offset: number): SourcePosition {
		const line = this.countNewlinesBefore(offset);
		const lastNewline = this.newlineOffsets[line - 1] ?? -1;
		return { line, character: offset - (lastNewline + 1) };
	}

	calculatePositionFromSourceOffset(offset: number): SourcePosition {
		const position = this.offsetToPositionFromLineStart(offset);
		// source tracker offsets are 1-based on the first line
		if (position.line === 0 && offset !== 0) {
			return { line: 0, character: offset - 1 };
		}
		return position;
	}

	private buildPositionMap(
		sourceTracker: SourceTracker,
		obj: object,
		parentPath: string[] = [],
	) {
		for (const [key, value] of Object.entries(obj)) {
			const keySource = sourceTracker.getKeySource(obj, key);
			const valueSource = sourceTracker.getValueSource(obj, key);

			if (keySource && valueSource) {
				this.positionMap.push({
					keyStart: this.calculatePositionFromSourceOffset(keySource.start),
					keyEnd: this.calculatePositionFromSourceOffset(keySource.end),
					valueStart: this.calculatePositionFromSourceOffset(valueSource.start),
					valueEnd: this.calculatePositionFromSourceOffset(valueSource.end),
					key: [...parentPath, key],
					value: value,
				});
			}

			if (value && typeof value === "object" && !Array.isArray(value)) {
				this.buildPositionMap(sourceTracker, value, [...parentPath, key]);
			}
		}
	}

	getAllPositions(): KeyPosition[] {
		return this.positionMap;
	}

	getKeyAtPosition(position: SourcePosition): KeyPosition | null {
		let currentEntry: KeyPosition | null = null;

		for (const entry of this.positionMap) {
			if (this.isPositionInRange(position, entry.keyStart, entry.keyEnd)) {
				if (!currentEntry || entry.key.length > currentEntry.key.length) {
					currentEntry = entry;
				}
			}
			if (this.isPositionInRange(position, entry.valueStart, entry.valueEnd)) {
				if (!currentEntry || entry.key.length > currentEntry.key.length) {
					currentEntry = entry;
				}
			}
		}
		return currentEntry;
	}

	private isPositionInRange(
		pos: SourcePosition,
		start: SourcePosition,
		end: SourcePosition,
	): boolean {
		if (pos.line === start.line && pos.line === end.line) {
			return pos.character >= start.character && pos.character <= end.character;
		}

		if (pos.line === start.line) {
			return pos.character >= start.character;
		}

		if (pos.line === end.line) {
			return pos.character <= end.character;
		}

		return pos.line > start.line && pos.line < end.line;
	}

	findRange(obj: object, needle: string) {
		let keySource: { start: number; end: number };
		try {
			keySource = this.sourceTracker.getKeySource(obj, needle);
		} catch (_e) {
			return undefined;
		}

		const start = this.offsetToPositionFromLineStart(keySource.start);
		const end = this.offsetToPositionFromLineStart(keySource.end);

		return new vscode.Range(
			new vscode.Position(start.line, start.character),
			new vscode.Position(end.line, end.character),
		);
	}
}

type ParserCacheEntry = {
	version: number;
	parser?: TomlParser<MiseTomlType>;
	// last successful parse, served while the document is mid-edit and invalid
	lastGood?: TomlParser<MiseTomlType>;
};

const parserCache = new Map<string, ParserCacheEntry>();
const PARSER_CACHE_MAX_ENTRIES = 32;

/**
 * Returns a `TomlParser` for the document, cached by document version so
 * repeated hover/definition/symbol requests do not re-parse the same content.
 * When the document does not parse (mid-edit), the last good parse is returned
 * instead; undefined only when the document never parsed successfully.
 */
export function getCachedTomlParser(
	document: vscode.TextDocument,
): TomlParser<MiseTomlType> | undefined {
	const key = document.uri?.toString();
	if (key === undefined) {
		// documents without a uri (e.g. test doubles) are parsed uncached
		try {
			return new TomlParser<MiseTomlType>(document.getText());
		} catch {
			return undefined;
		}
	}

	const previous = parserCache.get(key);
	if (previous && previous.version === document.version) {
		return previous.parser ?? previous.lastGood;
	}

	let parser: TomlParser<MiseTomlType> | undefined;
	try {
		parser = new TomlParser<MiseTomlType>(document.getText());
	} catch {
		parser = undefined;
	}

	// delete before set so re-parsed documents move to the end of the
	// insertion-ordered map, making the eviction below approximately LRU
	parserCache.delete(key);
	parserCache.set(key, {
		version: document.version,
		parser,
		lastGood: parser ?? previous?.lastGood,
	});
	if (parserCache.size > PARSER_CACHE_MAX_ENTRIES) {
		const oldest = parserCache.keys().next().value;
		if (oldest !== undefined) {
			parserCache.delete(oldest);
		}
	}

	return parser ?? previous?.lastGood;
}

/** Locate a tool declared in an asdf-style `.tool-versions` file */
function findToolVersionsPosition(
	document: vscode.TextDocument,
	toolNames: string[],
) {
	const lines = document.getText().split("\n");
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i]?.split("#")[0]?.match(/^(\s*)(\S+)/);
		if (match?.[2] && toolNames.includes(match[2])) {
			const start = match[1]?.length ?? 0;
			return new vscode.Range(
				new vscode.Position(i, start),
				new vscode.Position(i, start + match[2].length),
			);
		}
	}
	return undefined;
}

/**
 * Locate a tool declared in the package.json `devEngines` field
 * (https://mise.jdx.dev/lang/node.html)
 */
function findPackageJsonDevEnginesPosition(
	document: vscode.TextDocument,
	toolNames: string[],
) {
	const lines = document.getText().split("\n");
	let inDevEnginesSection = false;
	let braceDepth = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) {
			continue;
		}

		if (!inDevEnginesSection) {
			if (/"devEngines"\s*:/.test(line)) {
				inDevEnginesSection = true;
				braceDepth = 0;
			} else {
				continue;
			}
		}

		for (const toolName of toolNames) {
			const toolNameIndex = line.indexOf(`"${toolName}"`);
			if (toolNameIndex !== -1) {
				return new vscode.Range(
					new vscode.Position(i, toolNameIndex + 1),
					new vscode.Position(i, toolNameIndex + 1 + toolName.length),
				);
			}
		}

		braceDepth +=
			(line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0);
		if (braceDepth <= 0 && !/"devEngines"\s*:/.test(line)) {
			return undefined;
		}
	}

	return undefined;
}

export function findToolPosition(
	document: vscode.TextDocument,
	toolName: string,
) {
	const toolsToTry: string[] = [];
	toolsToTry.push(toolName);
	for (const [from, to] of TOOLS_MAPPING) {
		if (toolName === from) {
			toolsToTry.push(to);
		}
		if (toolName === to) {
			toolsToTry.push(from);
		}
	}

	if (document.fileName.endsWith("package.json")) {
		return findPackageJsonDevEnginesPosition(document, toolsToTry);
	}

	if (isToolVersionsFile(document.fileName)) {
		return findToolVersionsPosition(document, toolsToTry);
	}

	if (!document.fileName.endsWith("toml")) {
		return;
	}

	const tomParser = getCachedTomlParser(document);
	if (!tomParser) {
		return;
	}
	for (const tool of toolsToTry) {
		const range = tomParser.findRange(tomParser.parsed.tools ?? {}, tool);
		if (range) {
			return range;
		}
	}
}

export function findEnvVarPosition(
	documents: vscode.TextDocument[],
	envVarName: string,
) {
	for (const document of documents) {
		if (document.fileName.endsWith("toml")) {
			const parser = getCachedTomlParser(document);
			const range = parser?.findRange(parser.parsed.env ?? {}, envVarName);
			if (range) {
				return { document, range };
			}
		} else {
			const lines = document.getText().split("\n");
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (line?.includes(envVarName)) {
					const startPos = new vscode.Position(i, line.indexOf(envVarName));
					const endPos = startPos.translate(0, envVarName.length);
					return { document, range: new vscode.Range(startPos, endPos) };
				}
			}
		}
	}
	return undefined;
}

const TOP_OF_FILE = {
	start: new vscode.Position(0, 0),
	end: new vscode.Position(0, 0),
};

function findPackageJsonScriptPosition(
	document: vscode.TextDocument,
	scriptNames: string[],
) {
	const lines = document.getText().split("\n");
	let inScriptsSection = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) {
			continue;
		}

		if (!inScriptsSection) {
			if (/"scripts"\s*:/.test(line)) {
				inScriptsSection = true;
			}
			continue;
		}

		if (/^\s*}/.test(line)) {
			break;
		}

		for (const scriptName of scriptNames) {
			const scriptKeyIndex = line.indexOf(`"${scriptName}"`);
			if (scriptKeyIndex !== -1) {
				return {
					start: new vscode.Position(i, scriptKeyIndex + 1),
					end: new vscode.Position(i, scriptKeyIndex + 1 + scriptName.length),
				};
			}
		}
	}

	return undefined;
}

export function findTaskDefinition(
	document: vscode.TextDocument,
	taskName: string,
) {
	// config files key tasks by local name, mise reports qualified names
	const nameCandidates = getTaskDefinitionNameCandidates(taskName);

	if (document.fileName.endsWith("package.json")) {
		return (
			findPackageJsonScriptPosition(document, nameCandidates) ?? TOP_OF_FILE
		);
	}

	if (!document.fileName.endsWith(".toml")) {
		return TOP_OF_FILE;
	}

	try {
		const tomlParser = getCachedTomlParser(document);
		if (!tomlParser) {
			return TOP_OF_FILE;
		}

		for (const nameCandidate of nameCandidates) {
			let keyPosition: { start: number; end: number };
			let valuePosition: { start: number; end: number };
			try {
				keyPosition = tomlParser.sourceTracker.getKeySource(
					tomlParser.parsed?.tasks ?? tomlParser.parsed,
					nameCandidate,
				);
				valuePosition = tomlParser.sourceTracker.getValueSource(
					tomlParser.parsed?.tasks ?? tomlParser.parsed,
					nameCandidate,
				);
			} catch (_e) {
				continue;
			}

			if (!keyPosition || !valuePosition) {
				continue;
			}

			const startPosition = tomlParser.calculatePositionFromSourceOffset(
				keyPosition.start,
			);
			const endPosition = tomlParser.calculatePositionFromSourceOffset(
				valuePosition.end,
			);

			return {
				start: new vscode.Position(startPosition.line, startPosition.character),
				end: new vscode.Position(endPosition.line, endPosition.character),
			};
		}

		logger.info("Could not find task definition:", taskName);
		return TOP_OF_FILE;
	} catch (error) {
		logger.info("Error finding task definition:", error as Error);
		return TOP_OF_FILE;
	}
}
