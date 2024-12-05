import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VscodeButton, VscodeCheckbox } from "@vscode-elements/react-elements";
import { useState } from "react";
import CustomTable from "./components/CustomTable";
import { IconButton } from "./components/IconButton";
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
		wordBreak: "break-all",
		color: "var(--vscode-foreground)",
	},
} as const;

const ToolInfo = ({
	onClose,
	selectedTool,
}: { selectedTool: MiseTool; onClose: () => void }) => {
	const trackedConfigQuery = useQuery(trackedConfigsQueryOptions);
	const configs = trackedConfigQuery.data || [];

	if (!selectedTool) {
		return null;
	}

	const configsWithTool = configs.filter((config) => {
		return Object.keys(config.tools).includes(selectedTool.name);
	});

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
				<IconButton iconName={"close"} onClick={onClose} />
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
					<div style={styles.value}>
						{configsWithTool
							.map((config) => {
								// @ts-ignore
								const toolInfo = config.tools[selectedTool.name];
								return `${toDisplayPath(config.path)} (${JSON.stringify(toolInfo)})`;
							})
							.join(", ")}
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
			<VscodeButton
				title={"Info"}
				className="small-button"
				onClick={() => {
					onSelect(tool);
				}}
			>
				<i className="codicon codicon-info" />
			</VscodeButton>
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
	const [selectedTool, setSelectedTool] = useState<MiseTool | null>(null);
	const [showOutdatedOnly, setShowOutdatedOnly] = useState(false);
	const [activeOnly, setActiveOnly] = useState(false);

	const toolsQuery = useQuery({
		queryKey: ["tools"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<Array<MiseTool>>,
	});

	const pruneToolsMutations = useMutation({
		mutationKey: ["pruneTools"],
		mutationFn: () => vscodeClient.request({ mutationKey: ["pruneTools"] }),
	});

	const outdatedToolsQuery = useQuery({
		queryKey: ["outdatedTools"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<Array<MiseToolUpdate>>,
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
				style={{ height: window.innerHeight - (selectedTool ? 280 : 40) }}
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
							onClick={() => outdatedToolsQuery.refetch()}
						/>
						<VscodeCheckbox
							label={"Active only"}
							checked={activeOnly}
							onChange={(e) => {
								setActiveOnly(!activeOnly);
							}}
						/>
						<VscodeCheckbox
							label={"Outdated tools"}
							checked={showOutdatedOnly}
							onChange={(e) => {
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
						<p>
							{outdatedToolsQuery.isLoading ? "Loading outdated tools..." : ""}
						</p>
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
								// biome-ignore lint/a11y/useValidAnchor: <explanation>
								<a
									href="#"
									onClick={(e) => {
										setSelectedTool(row.original);
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
								onSelect={setSelectedTool}
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
