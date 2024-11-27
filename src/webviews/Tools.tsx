import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VscodeButton } from "@vscode-elements/react-elements";
import CustomTable from "./components/CustomTable";
import { vscodeClient } from "./webviewVsCodeApi";

const ActionCell = ({
	tool,
	outdatedToolInfo,
}: { tool: MiseTool; outdatedToolInfo?: MiseToolUpdate }) => {
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

	return (
		<div>
			<CustomTable
				filterRowElement={
					<div style={{ display: "flex", alignItems: "center" }}>
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
							{pruneToolsMutations.isPending
								? "Pruning..."
								: "Prune unused tools"}
						</VscodeButton>
						<VscodeButton
							title={"Refresh"}
							onClick={() => {
								return outdatedToolsQuery.refetch();
							}}
							style={{ background: "none", border: "none" }}
						>
							<i className={"codicon codicon-refresh"} />
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
								tool={props.row.original}
							/>
						),
					},
				]}
				data={toolsQuery?.data || []}
			/>
		</div>
	);
};
