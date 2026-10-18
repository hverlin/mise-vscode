/** An entry of `mise config explain --json` (mise 2026.10.14+): a key the file sets */
export type ConfigKeyExplanation = {
	key: string;
	path: string[];
	/** 1-based */
	line: number;
	description: string | null;
	deprecated: boolean;
	/** whether mise reads the key */
	known: boolean;
	/** the known key it most likely meant */
	suggestion: string | null;
};

export type ConfigKeyProblem = {
	kind: "unknown" | "deprecated";
	/** e.g. `settings.experimantal` */
	key: string;
	/** 0-based */
	line: number;
	/** the name of the key on its line, or the whole line when not found */
	start: number;
	end: number;
	/** the name of the key, when it was found on its line */
	name?: string;
	message: string;
	suggestion?: string;
};

const escapeRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where a key name is written on its line: `experimantal` in
 * `experimantal = true`, `settings.experimantal = true`, `[taks]` or
 * `{ depnds = [] }`, quoted or not
 */
export function findKeyName(
	lineText: string,
	name: string,
): { start: number; end: number } | undefined {
	const match = new RegExp(
		`(^|[\\s.{,\\[])(["']?)${escapeRegExp(name)}\\2(?=\\s*[=.\\]])`,
	).exec(lineText);
	if (!match) {
		return undefined;
	}
	const start = match.index + (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
	return { start, end: start + name.length };
}

/**
 * What a deprecated key's description says to do: `use env._.file instead.`
 * out of `dotenv file(s) to load. Deprecated; use env._.file instead.`, or
 * the whole description when it does not say "deprecated", e.g. `[deprecated]
 * Old name for self_update.auto.`
 */
function deprecationAdvice(description: string | null): string | undefined {
	const text = description?.replace(/^\s*\[deprecated\]\s*/i, "").trim();
	if (!text) {
		return undefined;
	}
	return text.match(/\bdeprecated\b[;:,.]?\s*(.+)$/i)?.[1]?.trim() ?? text;
}

/**
 * The keys of a config file mise does not read, or reads but deprecates, out
 * of `mise config explain --json`, located in the lines of the file
 */
export function findConfigKeyProblems(
	explanations: ConfigKeyExplanation[],
	lines: string[],
): ConfigKeyProblem[] {
	return explanations.flatMap((explanation): ConfigKeyProblem[] => {
		if (explanation.known && !explanation.deprecated) {
			return [];
		}

		const line = explanation.line - 1;
		const lineText = lines[line];
		if (lineText === undefined) {
			return [];
		}
		const name = explanation.path.at(-1) ?? explanation.key;
		const found = findKeyName(lineText, name);
		const indent = lineText.length - lineText.trimStart().length;
		const range = found
			? { ...found, name }
			: { start: indent, end: lineText.trimEnd().length };

		if (!explanation.known) {
			// mise suggests `_`, the env directives, for any short unknown key
			const suggestion =
				explanation.suggestion && explanation.suggestion !== "_"
					? explanation.suggestion
					: undefined;
			return [
				{
					kind: "unknown",
					key: explanation.key,
					line,
					...range,
					message: `mise does not read \`${explanation.key}\`.${
						suggestion ? ` Did you mean \`${suggestion}\`?` : ""
					}`,
					suggestion,
				},
			];
		}

		const advice = deprecationAdvice(explanation.description);
		return [
			{
				kind: "deprecated",
				key: explanation.key,
				line,
				...range,
				message: `\`${explanation.key}\` is deprecated${advice ? `: ${advice}` : "."}`,
			},
		];
	});
}
