export function uniqBy<T>(array: T[], iteratee: (value: T) => string): T[] {
	if (!Array.isArray(array)) {
		throw new TypeError("Expected an array as first argument");
	}

	const seen = new Map<string, T>();

	for (const item of array) {
		const key = iteratee(item);
		if (!seen.has(key)) {
			seen.set(key, item);
		}
	}

	return Array.from(seen.values());
}

export const truncateStr = (str: string, maxLen: number) => {
	if (str.length <= maxLen) {
		return str;
	}
	return `${str.slice(0, maxLen)}...`;
};

// biome-ignore lint/suspicious/noExplicitAny: generic debounce
export function debounce<T extends (...args: any[]) => void>(
	fn: T,
	delayMs: number,
): (...args: Parameters<T>) => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return (...args: Parameters<T>) => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => fn(...args), delayMs);
	};
}

/**
 * Runs `run` once per request, coalescing: the requests made while it runs
 * share one more run, started once it is done. Never the run in progress,
 * which may have read the state from before the request.
 */
export function coalesceRuns(run: () => Promise<void>): () => Promise<void> {
	let running: Promise<void> | undefined;
	let next: Promise<void> | undefined;
	const request = (): Promise<void> => {
		if (!running) {
			running = run().finally(() => {
				running = undefined;
			});
			return running;
		}
		// a failed run must not take the next one down with it
		next ??= running
			.catch(() => undefined)
			.then(() => {
				next = undefined;
				return request();
			});
		return next;
	};
	return request;
}

export const mergeArrays = (
	arr: Array<[string, string | undefined]>,
): Record<string, string> => {
	const result: Record<string, string> = {};
	for (const [k, p] of arr) {
		if (p !== undefined) {
			result[k] = p;
		}
	}
	return result;
};
