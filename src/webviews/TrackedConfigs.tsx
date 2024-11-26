import { useMutation, useQuery } from "@tanstack/react-query";
import CustomTable from "./components/CustomTable";
import { vscodeClient } from "./webviewVsCodeApi";

export const TrackedConfigs = () => {
	const settingsQuery = useQuery({
		queryKey: ["trackedConfigs"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<
				Array<{ path: string; tools: object }>
			>,
	});

	const openFileMutation = useMutation({
		mutationKey: ["openFile"],
		mutationFn: (path: string) =>
			vscodeClient.request({ mutationKey: ["openFile"], variables: { path } }),
	});

	if (settingsQuery.isError) {
		return <div>Error: {settingsQuery.error.message}</div>;
	}

	return (
		<div>
			<CustomTable
				filterRowElement={"Showing tracked config files"}
				isLoading={settingsQuery.isLoading}
				data={settingsQuery.data || []}
				columns={[
					{
						id: "path",
						header: "File",
						accessorKey: "path",
						cell: ({ row }) => {
							return (
								<a
									href={`#${row.original.path}`}
									onClick={(e) => {
										e.preventDefault();
										openFileMutation.mutate(row.original.path);
									}}
									title={row.original.path}
								>
									{row.original.path}
								</a>
							);
						},
					},
					{
						id: "tools",
						header: "Tools",
						accessorKey: "tools",
						cell: ({ row }) => {
							return Object.entries(row.original.tools).map(
								([toolName, toolVersion]) => (
									<div key={toolName}>
										{toolName} = {JSON.stringify(toolVersion)}
									</div>
								),
							);
						},
					},
				]}
			/>
		</div>
	);
};
