import { Bootstrap } from "./Bootstrap";
import { Projects } from "./Projects";
import { Settings } from "./Settings";
import { TasksDependencies } from "./TasksDependencies";
import { Tools } from "./Tools";

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
			) : view === "TASKS_DEPS" ? (
				<TasksDependencies />
			) : view === "BOOTSTRAP" ? (
				<Bootstrap />
			) : (
				<Projects />
			)}
		</div>
	);
}
