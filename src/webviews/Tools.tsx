import { useQuery } from "@tanstack/react-query";
import VSCodeTable from "./VSCodeTable";
import { vscodeClient } from "./webviewVsCodeApi";

export const Tools = () => {
	const toolsQuery = useQuery({
		queryKey: ["tools"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<
				Array<{
					name: string;
					version: string;
					requested_version: string;
					active: boolean;
					installed: boolean;
				}>
			>,
	});

	if (toolsQuery.isError) {
		return <div>Error: {toolsQuery.error.message}</div>;
	}

	return (
		<div>
			<VSCodeTable
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
					},
					{
						id: "installed",
						header: "Installed",
						accessorKey: "installed",
					},
					{
						id: "install_path",
						header: "Install Path",
						accessorKey: "install_path",
					},
				]}
				data={toolsQuery?.data || []}
			/>
		</div>
	);
};
