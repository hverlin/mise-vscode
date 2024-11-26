import { VscodeTextfield } from "@vscode-elements/react-elements";
import { type InputHTMLAttributes, useEffect, useState } from "react";

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

	useEffect(() => {
		setValue(initialValue);
	}, [initialValue]);

	useEffect(() => {
		const timeout = setTimeout(() => {
			onChange(value);
		}, debounce);

		return () => clearTimeout(timeout);
	}, [value, debounce, onChange]);

	return (
		<VscodeTextfield
			{...props}
			// @ts-ignore
			value={value}
			// @ts-ignore
			onInput={(e) => setValue(e.target.value)}
		/>
	);
}
