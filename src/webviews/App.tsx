import { Settings } from "./Settings";
import { Tools } from "./Tools";
import { Tabs } from "./components/Tabs";

export function App() {
	return (
		<div>
			<Tabs
				tabs={[
					{
						name: "Tools",
						content: <Tools />,
						icon: "codicon codicon-tools",
					},
					{
						name: "Settings",
						content: <Settings />,
						icon: "codicon codicon-settings",
					},
				]}
			/>
		</div>
	);
}
