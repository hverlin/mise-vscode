import { VscodeButton } from "@vscode-elements/react-elements";
import type { ComponentProps } from "react";

export function IconButton({
	iconName,
	...props
}: {
	iconName: string;
} & ComponentProps<typeof VscodeButton>) {
	return (
		<VscodeButton
			{...props}
			secondary
			style={{ padding: 0, background: "none", border: "none" }}
		>
			<i className={`codicon codicon-${iconName}`} />
		</VscodeButton>
	);
}
