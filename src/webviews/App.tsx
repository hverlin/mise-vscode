import { Settings } from "./Settings";
import { Tools } from "./Tools";
import { TrackedConfigs } from "./TrackedConfigs";

export function App() {
	const view = document
		.querySelector("meta[name=view]")
		?.getAttribute("content");

	return (
		<div>
			{view === "TOOLS" ? (
				<Tools />
			) : view === "SETTINGS" ? (
				<Settings />
			) : (
				<TrackedConfigs />
			)}
		</div>
	);
}
