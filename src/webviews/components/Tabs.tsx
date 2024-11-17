import { type ReactNode, useState } from "react";

export function Tabs({
	tabs,
}: {
	tabs: Array<{ name: string; icon?: string; content: ReactNode }>;
}) {
	const [selectedTab, setSelectedTab] = useState(tabs[0]?.name ?? "");

	return (
		<div style={{ height: "100%", position: "relative" }}>
			<nav className="vscode-tabs">
				{tabs.map((tab) => (
					<div
						onClick={() => setSelectedTab(tab.name)}
						className={[
							"vscode-tab",
							tab.name === selectedTab ? "active" : "",
						].join(" ")}
						key={tab.name}
						role={"tab"}
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								setSelectedTab(tab.name);
							}
						}}
					>
						{tab.icon ? <i className={`vscode-tab-icon ${tab.icon}`} /> : null}
						<div className={"vscode-tab-content"}>{tab.name}</div>
					</div>
				))}
			</nav>

			{tabs.find((tab) => tab.name === selectedTab)?.content}
		</div>
	);
}
