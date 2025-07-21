/**
 * https://github.com/djkepa/custom-react-hooks/blob/main/packages/use-window-size/src/index.tsx
 * @license MIT Branislav Grozdanović
 *
 * `useWindowSize` is a hook that tracks the size of the browser window.
 * It updates the width and height of the window upon resize, with an optional debounce delay.
 *
 * @param debounceDelay - (Optional) The debounce delay in milliseconds for resize events.
 * @return - An object containing the current width and height of the window.
 */

/** biome-ignore-all lint/style/noNonNullAssertion: ok */

import { useCallback, useEffect, useState } from "react";

export function useWindowSize(debounceDelay = 100) {
	const getSize = () => ({
		width: typeof window !== "undefined" ? window.innerWidth : 0,
		height: typeof window !== "undefined" ? window.innerHeight : 0,
	});

	const [windowSize, setWindowSize] = useState(getSize);

	const debounce = (fn: () => void, ms: number) => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		// biome-ignore lint/suspicious/noExplicitAny: ok
		return (..._args: any[]) => {
			clearTimeout(timer!);
			timer = setTimeout(() => {
				timer = null;
				fn();
			}, ms);
		};
	};

	const handleResize = useCallback(() => {
		const handleResizeDebounced = debounce(() => {
			setWindowSize(getSize());
		}, debounceDelay);
		handleResizeDebounced();
		// biome-ignore lint/correctness/useExhaustiveDependencies: ok
	}, [debounceDelay, getSize, debounce]);

	useEffect(() => {
		if (typeof window !== "undefined") {
			window.addEventListener("resize", handleResize);
			return () => window.removeEventListener("resize", handleResize);
		}
	}, [handleResize]);

	return windowSize;
}
