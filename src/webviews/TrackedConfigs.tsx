import { useQuery } from "@tanstack/react-query";
import CustomTable from "./components/CustomTable";
import { FileLink } from "./components/FileLink";
import { useWindowSize } from "./components/UseWindowSize";
import { trackedConfigsQueryOptions } from "./webviewVsCodeApi";

export const TrackedConfigs = () => {
	const windowSize = useWindowSize();
	const trackedConfigQuery = useQuery(trackedConfigsQueryOptions);

	if (trackedConfigQuery.isError) {
		return <div>Error: {trackedConfigQuery.error.message}</div>;
	}

	return (
		<div>
			<CustomTable
				style={{ height: windowSize.height - 40 }}
				filterRowElement={
					<span style={{ opacity: 0.8 }}>Showing tracked config files</span>
				}
				isLoading={trackedConfigQuery.isLoading}
				data={trackedConfigQuery.data || []}
				columns={[
					{
						id: "path",
						header: "File",
						accessorKey: "path",
						cell: ({ row }) => <FileLink filePath={row.original.path} />,
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
