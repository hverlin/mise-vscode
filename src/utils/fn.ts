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
