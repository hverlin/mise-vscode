import { useMutation, useQuery } from "@tanstack/react-query";
import CustomTable from "./components/CustomTable";
import {
	toDisplayPath,
	trackedConfigsQueryOptions,
	vscodeClient,
} from "./webviewVsCodeApi";

export const TrackedConfigs = () => {
	const trackedConfigQuery = useQuery(trackedConfigsQueryOptions);

	const openFileMutation = useMutation({
		mutationKey: ["openFile"],
		mutationFn: (path: string) =>
			vscodeClient.request({ mutationKey: ["openFile"], variables: { path } }),
	});

	if (trackedConfigQuery.isError) {
		return <div>Error: {trackedConfigQuery.error.message}</div>;
	}

	return (
		<div>
			<CustomTable
				filterRowElement={"Showing tracked config files"}
				isLoading={trackedConfigQuery.isLoading}
				data={trackedConfigQuery.data || []}
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
									{toDisplayPath(row.original.path)}
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
