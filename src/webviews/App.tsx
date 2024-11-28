import { Settings } from "./Settings";
import { Tools } from "./Tools";
import { TrackedConfigs } from "./TrackedConfigs";
import { Tabs } from "./components/Tabs";

export function App() {
	const initialPathMeta = document.querySelector('meta[name="initial-path"]');

	return (
		<div>
			<Tabs
				initialTab={
					initialPathMeta?.getAttribute("content") === "settings"
						? "Settings"
						: "Tools"
				}
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
					{
						name: "Tracked Configs",
						content: <TrackedConfigs />,
						icon: "codicon codicon-file",
					},
				]}
			/>
		</div>
	);
}
