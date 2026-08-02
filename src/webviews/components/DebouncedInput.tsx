import { VscodeTextfield } from "@vscode-elements/react-elements";
import { type InputHTMLAttributes, useEffect, useRef, useState } from "react";

export function DebouncedInput({
	value: initialValue,
	onChange,
	debounce = 100,
	...props
}: {
	value: string | number;
	onChange: (value: string | number) => void;
	debounce?: number;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange">) {
	const [value, setValue] = useState(initialValue);

	// the debounced onChange makes the parent re-render with the value we just
	// emitted; syncing that echo back into local state would overwrite (drop)
	// characters typed in the meantime. Only accept genuine external changes.
	const lastEmitted = useRef(initialValue);
	useEffect(() => {
		if (initialValue !== lastEmitted.current) {
			lastEmitted.current = initialValue;
			setValue(initialValue);
		}
	}, [initialValue]);

	// keep the latest onChange without restarting the debounce timer when the
	// parent re-renders with a new function identity
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	useEffect(() => {
		const timeout = setTimeout(() => {
			lastEmitted.current = value;
			onChangeRef.current(value);
		}, debounce);

		return () => clearTimeout(timeout);
	}, [value, debounce]);

	return (
		<VscodeTextfield
			{...props}
			// @ts-expect-error
			value={value}
			// @ts-expect-error
			onInput={(e) => setValue(e.target.value)}
		/>
	);
}
