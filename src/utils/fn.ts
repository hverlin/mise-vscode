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
