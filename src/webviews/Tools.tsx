import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VscodeButton } from "@vscode-elements/react-elements";
import CustomTable from "./components/CustomTable";
import { vscodeClient } from "./webviewVsCodeApi";

const ActionCell = ({ tool }: { tool: MiseTool }) => {
	const queryClient = useQueryClient();
	const mutationKey = ["uninstallTool", tool.name, tool.version];
	const removeToolMutation = useMutation({
		mutationKey,
		mutationFn: () => vscodeClient.request({ mutationKey }),
	});

	if (!tool.installed) {
		return null;
	}

	return (
		<VscodeButton
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
			<i className="codicon codicon-close" />
			{removeToolMutation.isPending ? "Removing..." : "Remove"}
		</VscodeButton>
	);
};

export const Tools = () => {
	const toolsQuery = useQuery({
		queryKey: ["tools"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<Array<MiseTool>>,
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
						cell: (props) => <ActionCell tool={props.row.original} />,
					},
				]}
				data={toolsQuery?.data || []}
			/>
			{outdatedToolsQuery.isLoading ? "Loading outdated tools..." : ""}
		</div>
	);
};
