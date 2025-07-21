import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VscodeButton, VscodeCheckbox } from "@vscode-elements/react-elements";
import { useState } from "react";
import CustomTable from "./components/CustomTable";
import { FileLink } from "./components/FileLink";
import { IconButton } from "./components/IconButton";
import { useWindowSize } from "./components/UseWindowSize";
import { useWebviewStore } from "./store";
import {
	toDisplayPath,
	trackedConfigsQueryOptions,
	vscodeClient,
} from "./webviewVsCodeApi";

const styles = {
	infoPanel: { padding: "10px" },
	header: { marginBottom: "10px" },
	title: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
		fontSize: "16px",
		fontWeight: "bold",
		color: "var(--vscode-foreground)",
	},
	label: {
		fontSize: "12px",
		color: "var(--vscode-descriptionForeground)",
		marginBottom: "4px",
	},
	value: {
		fontSize: "14px",
		wordBreak: "break-word",
		color: "var(--vscode-foreground)",
	},
	toggleButton: {
		display: "flex",
		alignItems: "center",
		gap: "4px",
		color: "var(--vscode-textLink-foreground)",
		cursor: "pointer",
		background: "none",
		border: "none",
		padding: "4px 0",
		marginTop: "0px",
	},
	pathContainer: {
		display: "flex",
		flexDirection: "column" as const,
		gap: "6px",
	},
	pathItem: {
		display: "flex",
		alignItems: "center",
	},
	pathInfo: {
		marginLeft: "8px",
		opacity: 0.8,
	},
} as const;

const ToolInfo = ({
	onClose,
	selectedTool,
}: {
	selectedTool: MiseTool;
	onClose: () => void;
}) => {
	const [showAll, setShowAll] = useState(false);
	const trackedConfigQuery = useQuery(trackedConfigsQueryOptions);
	const configs = trackedConfigQuery.data || [];

	if (!selectedTool) {
		return null;
	}

	const configsWithTool = configs.filter((config) => {
		return Object.keys(config.tools).includes(selectedTool.name);
	});

	const displayedConfigs = showAll
		? configsWithTool
		: configsWithTool.slice(0, 3);
	const hasMore = configsWithTool.length > 3;

	return (
		<div style={styles.infoPanel}>
			<div
				style={{
					marginBottom: "10px",
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<div style={styles.title}>
					<i className="codicon codicon-tools" />
					{selectedTool.name}
				</div>
				<IconButton iconName="close" onClick={onClose} />
			</div>

			<div>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(3, 1fr)",
						marginBottom: "0",
					}}
				>
					<div>
						<p style={styles.label}>Version</p>
						<p style={styles.value}>{selectedTool.version}</p>
					</div>
					<div>
						<p style={styles.label}>Requested Version</p>
						<p style={styles.value}>
							{selectedTool.requested_version || "None"}
						</p>
					</div>
					<div>
						<p style={styles.label}>Status</p>
						<p style={styles.value}>
							{selectedTool.installed ? "Installed" : "Not Installed"}
						</p>
					</div>

					{selectedTool.install_path && (
						<div>
							<p style={styles.label}>Install Path</p>
							<p style={styles.value}>
								{toDisplayPath(selectedTool.install_path)}
							</p>
						</div>
					)}

					{selectedTool.source?.path && (
						<div>
							<p style={styles.label}>Requested by</p>
							<p style={styles.value}>
								{toDisplayPath(selectedTool.source.path)}
							</p>
						</div>
					)}
				</div>
			</div>

			{configsWithTool.length > 0 && (
				<div>
					<p style={styles.label}>Used in</p>
					<div style={styles.pathContainer}>
						{displayedConfigs.map((config) => {
							// @ts-ignore
							const toolInfo = config.tools[selectedTool.name];
							return (
								<span
									key={config.path + selectedTool.name}
									style={styles.pathItem}
								>
									<FileLink filePath={config.path} />
									<span style={styles.pathInfo}>
										({JSON.stringify(toolInfo)})
									</span>
								</span>
							);
						})}

						{hasMore && (
							<button
								type={"button"}
								onClick={() => setShowAll(!showAll)}
								style={styles.toggleButton}
							>
								<i
									className={`codicon codicon-chevron-${showAll ? "up" : "down"}`}
								/>
								{showAll
									? "Show less"
									: `Show ${configsWithTool.length - 3} more`}
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
};

const ActionCell = ({
	tool,
	outdatedToolInfo,
	onSelect,
}: {
	tool: MiseTool;
	outdatedToolInfo?: MiseToolUpdate;
	onSelect: (tool: MiseTool) => void;
}) => {
	const queryClient = useQueryClient();
	const mutationKey = ["uninstallTool", tool.name, tool.version];
	const removeToolMutation = useMutation({
		mutationKey,
		mutationFn: () => vscodeClient.request({ mutationKey }),
	});

	const installToolMutation = useMutation({
		mutationKey: ["installTool", tool.name, tool.version],
		mutationFn: () =>
			vscodeClient.request({
				mutationKey: ["installTool", tool.name, tool.version],
			}),
	});

	const upgradeToolMutation = useMutation({
		mutationKey: ["upgradeTool", tool.name, tool.requested_version],
		mutationFn: () =>
			vscodeClient.request({
				mutationKey: ["upgradeTool", tool.name, tool.requested_version],
			}),
	});

	if (!tool.installed) {
		return (
			<VscodeButton
				title={"Install"}
				disabled={installToolMutation.isPending}
				onClick={() => {
					return installToolMutation.mutate(undefined, {
						onSettled: () =>
							queryClient.invalidateQueries({ queryKey: ["tools"] }),
					});
				}}
			>
				<i className="codicon codicon-cloud-download" />
			</VscodeButton>
		);
	}

	return (
		<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
			{outdatedToolInfo && (
				<VscodeButton
					title={"Upgrade"}
					className="small-button"
					disabled={upgradeToolMutation.isPending}
					onClick={() => {
						return upgradeToolMutation.mutate(undefined, {
							onSettled: () =>
								queryClient.invalidateQueries({ queryKey: ["tools"] }),
						});
					}}
				>
					<i className="codicon codicon-arrow-up" />
				</VscodeButton>
			)}
			<VscodeButton
				title={"Info"}
				secondary
				className="small-button"
				onClick={() => {
					onSelect(tool);
				}}
			>
				<i className="codicon codicon-info" />
			</VscodeButton>
			<VscodeButton
				title={"Uninstall"}
				className="small-button"
				secondary
				disabled={removeToolMutation.isPending}
				onClick={() => {
					return removeToolMutation.mutate(undefined, {
						onSettled: () =>
							queryClient.invalidateQueries({ queryKey: ["tools"] }),
					});
				}}
			>
				<i className="codicon codicon-trash" />
			</VscodeButton>
		</div>
	);
};

export const Tools = () => {
	const queryClient = useQueryClient();
	const windowSize = useWindowSize();

	const selectedTool = useWebviewStore((state) => state.selectedTool);
	const setSelectedTool = useWebviewStore((state) => state.setSelectedTool);

	const showOutdatedOnly = useWebviewStore((state) => state.showOutdatedOnly);
	const setShowOutdatedOnly = useWebviewStore(
		(state) => state.setShowOutdatedOnly,
	);
	const activeOnly = useWebviewStore((state) => state.showActiveToolsOnly);
	const setActiveOnly = useWebviewStore(
		(state) => state.setShowActiveToolsOnly,
	);

	const toolsQuery = useQuery({
		queryKey: ["tools"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<Array<MiseTool>>,
	});

	const pruneToolsMutations = useMutation({
		mutationKey: ["pruneTools"],
		mutationFn: () => vscodeClient.request({ mutationKey: ["pruneTools"] }),
	});

	const trackedConfigQuery = useQuery(trackedConfigsQueryOptions);
	const configs = trackedConfigQuery.data || [];

	const configsWithTool = selectedTool
		? configs.filter((config) => {
				return Object.keys(config.tools).includes(selectedTool.name);
			})
		: [];

	const outdatedToolsQuery = useQuery({
		queryKey: ["outdatedTools"],
		queryFn: ({ queryKey }) => {
			if (!navigator.onLine) {
				return [];
			}

			return vscodeClient.request({ queryKey }) as Promise<
				Array<MiseToolUpdate>
			>;
		},
	});

	if (toolsQuery.isError) {
		return <div>Error: {toolsQuery.error.message}</div>;
	}

	const rows: MiseTool[] = [];
	for (const tool of toolsQuery.data || []) {
		if (
			showOutdatedOnly &&
			!outdatedToolsQuery.data?.find(
				(outdatedTool) =>
					outdatedTool.name === tool.name &&
					outdatedTool.version === tool.version,
			)
		) {
			continue;
		}

		if (activeOnly && !tool.active) {
			continue;
		}

		rows.push(tool);
	}

	return (
		<div>
			{selectedTool && (
				<ToolInfo
					onClose={() => setSelectedTool(null)}
					selectedTool={selectedTool}
				/>
			)}
			<CustomTable
				style={{
					height:
						windowSize.height -
						(selectedTool ? (configsWithTool?.length > 3 ? 320 : 280) : 40),
				}}
				filterRowElement={
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 10,
							flexWrap: "wrap",
						}}
					>
						<IconButton
							title={"Refresh"}
							iconName={"refresh"}
							onClick={() => queryClient.invalidateQueries()}
						/>
						<VscodeCheckbox
							label={"Active only"}
							checked={activeOnly}
							onChange={(_e) => {
								setActiveOnly(!activeOnly);
							}}
						/>
						<VscodeCheckbox
							label={"Outdated tools"}
							checked={showOutdatedOnly}
							onChange={(_e) => {
								setShowOutdatedOnly(!showOutdatedOnly);
							}}
						/>
						<VscodeButton
							secondary
							disabled={pruneToolsMutations.isPending}
							onClick={() => {
								return pruneToolsMutations.mutate(undefined, {
									onSettled: () =>
										queryClient.invalidateQueries({ queryKey: ["tools"] }),
								});
							}}
						>
							{pruneToolsMutations.isPending ? "Pruning..." : "Prune tools"}
						</VscodeButton>
						<div>
							{outdatedToolsQuery.isLoading ? "Loading outdated tools..." : ""}
						</div>
					</div>
				}
				isLoading={toolsQuery.isLoading}
				columns={[
					{
						id: "name",
						header: "Name",
						accessorKey: "name",
						cell: ({ row }) => {
							return (
								// biome-ignore lint/a11y/useValidAnchor: todo
								<a
									href="#"
									onClick={(_e) => {
										if (selectedTool === row.original) {
											setSelectedTool(null);
										} else {
											setSelectedTool(row.original);
										}
									}}
								>
									{row.original.name}
								</a>
							);
						},
					},
					{
						id: "version",
						header: "Version",
						accessorKey: "version",
						cell: ({ row }) => {
							const outdatedToolInfo = outdatedToolsQuery.data?.find(
								(outdatedTool) =>
									outdatedTool.name === row.original.name &&
									outdatedTool.version === row.original.version,
							);
							return (
								<div title={row.original.source?.path}>
									{row.original.version}
									{outdatedToolInfo ? (
										<small>
											<br />({outdatedToolInfo.latest} is available)
										</small>
									) : (
										""
									)}
								</div>
							);
						},
					},
					{
						id: "requested_version",
						header: "Requested Version",
						accessorKey: "requested_version",
					},
					{
						id: "active",
						header: "Active",
						accessorKey: "active",
						cell: ({ row }) => {
							return (
								<div title={row.original.source?.path}>
									{row.original.active ? "Yes" : "No"}
								</div>
							);
						},
					},
					{
						id: "installed",
						header: "Installed",
						accessorKey: "installed",
						cell: ({ row }) => {
							return (
								<div title={row.original.install_path}>
									{row.original.installed ? "Yes" : "No"}
								</div>
							);
						},
					},
					{
						id: "Actions",
						header: "Actions",
						cell: (props) => (
							<ActionCell
								outdatedToolInfo={outdatedToolsQuery.data?.find(
									(outdatedTool) =>
										outdatedTool.name === props.row.original.name &&
										outdatedTool.version === props.row.original.version,
								)}
								onSelect={(tool) => {
									if (selectedTool === tool) {
										setSelectedTool(null);
									} else {
										setSelectedTool(tool);
									}
								}}
								tool={props.row.original}
							/>
						),
					},
				]}
				data={rows}
			/>
		</div>
	);
};
