import { SourceTracker, parse } from "toml-v1";
import * as vscode from "vscode";
import { logger } from "./logger";
import { TOOLS_MAPPING } from "./miseUtilts";

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

// TODO: implement a better parser & improve performance
export class TomlParser<T extends object> {
	public sourceTracker: SourceTracker;
	public parsed: T;
	private positionMap: KeyPosition[] = [];

	constructor(private readonly source: string) {
		this.source = source;
		this.sourceTracker = new SourceTracker();
		this.parsed = parse(source, "", this.sourceTracker);

		this.buildPositionMap(this.sourceTracker, this.parsed);
	}

	calculatePositionFromSourceOffset(offset: number): SourcePosition {
		let line = 0;
		// source tracker is 1-based
		let character = offset === 0 ? offset : offset - 1;

		for (let i = 0; i < offset; i++) {
			if (this.source[i] === "\n") {
				line++;
				character = offset - (i + 1);
			}
		}

		return { line, character };
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
		} catch (e) {
			return undefined;
		}

		let line = 0;
		let lastNewLine = -1;

		for (let i = 0; i < keySource.end; i++) {
			if (this.source[i] === "\n") {
				line++;
				lastNewLine = i;
			}
		}

		let startLine = 0;
		let startChar = keySource.start;
		for (let i = 0; i < keySource.start; i++) {
			if (this.source[i] === "\n") {
				startLine++;
				startChar = keySource.start - (i + 1);
			}
		}

		return new vscode.Range(
			new vscode.Position(startLine, startChar),
			new vscode.Position(line, keySource.end - (lastNewLine + 1)),
		);
	}
}

export function findToolPosition(
	document: vscode.TextDocument,
	toolName: string,
) {
	if (!document.fileName.endsWith("toml")) {
		return;
	}

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

	const tomParser = new TomlParser<MiseTomlType>(document.getText());
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
			const parser = new TomlParser<MiseTomlType>(document.getText());
			const range = parser.findRange(parser.parsed.env ?? {}, envVarName);
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

export function findTaskDefinition(
	document: vscode.TextDocument,
	taskName: string,
) {
	if (!document.fileName.endsWith(".toml")) {
		return {
			start: new vscode.Position(0, 0),
			end: new vscode.Position(0, 0),
		};
	}

	try {
		const text = document.getText();

		const tomlParser = new TomlParser<MiseTomlType>(text);
		const keyPosition = tomlParser.sourceTracker.getKeySource(
			tomlParser.parsed?.tasks ?? tomlParser.parsed,
			taskName,
		);
		const valuePosition = tomlParser.sourceTracker.getValueSource(
			tomlParser.parsed?.tasks ?? tomlParser.parsed,
			taskName,
		);

		if (!keyPosition || !valuePosition) {
			logger.info("Could not find task definition:", taskName);
			return {
				start: new vscode.Position(0, 0),
				end: new vscode.Position(0, 0),
			};
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
	} catch (error) {
		logger.info("Error finding task definition:", error as Error);
		return {
			start: new vscode.Position(0, 0),
			end: new vscode.Position(0, 0),
		};
	}
}
