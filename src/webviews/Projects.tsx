import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VscodeButton, VscodeCheckbox } from "@vscode-elements/react-elements";
import { useEffect, useState } from "react";
import CustomTable from "./components/CustomTable";
import { DebouncedInput } from "./components/DebouncedInput";
import { FileLink } from "./components/FileLink";
import { IconButton } from "./components/IconButton";
import { useWindowSize } from "./components/UseWindowSize";
import { useWebviewStore } from "./store";
import { toDisplayPath, vscodeClient } from "./webviewVsCodeApi";

export const Projects = () => {
	const windowSize = useWindowSize();
	const {
		showIdiomaticFiles,
		setShowIdiomaticFiles,
		showFlatFileView,
		setShowFlatFileView,
	} = useWebviewStore();

	// the deprecated tracked-configs command opens this view in flat file mode
	useEffect(() => {
		if (
			document
				.querySelector("meta[name='flatFileView']")
				?.getAttribute("content") === "true"
		) {
			setShowFlatFileView(true);
		}
	}, [setShowFlatFileView]);

	const projectsQuery = useQuery({
		queryKey: ["projects"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<MiseProjectsData>,
	});

	const openProjectMutation = useMutation({
		mutationKey: ["openProjectInNewWindow"],
		mutationFn: (path: string) =>
			vscodeClient.request({
				mutationKey: ["openProjectInNewWindow"],
				variables: { path },
			}),
	});

	const queryClient = useQueryClient();
	const refreshProjects = () =>
		queryClient.invalidateQueries({ queryKey: ["projects"] });

	const addScanDirMutation = useMutation({
		mutationKey: ["addProjectScanDirectory"],
		mutationFn: () =>
			vscodeClient.request({ mutationKey: ["addProjectScanDirectory"] }),
	});

	const removeScanDirMutation = useMutation({
		mutationKey: ["removeProjectScanDirectory"],
		mutationFn: (path: string) =>
			vscodeClient.request({
				mutationKey: ["removeProjectScanDirectory"],
				variables: { path },
			}),
	});

	const [toolFilter, setToolFilter] = useState("");
	const matchesToolFilter = (toolNames: string[]) =>
		!toolFilter ||
		toolNames.some((name) =>
			name.toLowerCase().includes(toolFilter.toLowerCase()),
		);

	if (projectsQuery.isError) {
		return <div>Error: {projectsQuery.error.message}</div>;
	}

	const scanDirectories = projectsQuery.data?.scanDirectories ?? [];

	// own line above the table: the chips can grow long paths
	const scanBar = (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				flexWrap: "wrap",
				margin: "4px 0",
			}}
		>
			<VscodeButton
				secondary
				title="Pick a folder and scan it recursively for mise projects"
				disabled={addScanDirMutation.isPending}
				onClick={() =>
					addScanDirMutation.mutate(undefined, {
						onSuccess: (dir) => {
							if (dir) {
								refreshProjects();
							}
						},
					})
				}
			>
				{addScanDirMutation.isPending ? "Scanning..." : "Scan folder…"}
			</VscodeButton>
			{scanDirectories.map((dir) => (
				<span
					key={dir}
					style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}
				>
					<span style={{ opacity: 0.8 }}>{toDisplayPath(dir)}</span>
					<IconButton
						iconName="close"
						title="Stop scanning this folder"
						disabled={removeScanDirMutation.isPending}
						onClick={() =>
							removeScanDirMutation.mutate(dir, {
								onSettled: () => refreshProjects(),
							})
						}
					/>
				</span>
			))}
		</div>
	);

	const toggles = (
		<>
			<DebouncedInput
				style={{ width: 120 }}
				value={toolFilter}
				onChange={(value) => setToolFilter(String(value))}
				placeholder="Filter by tool"
			/>
			<VscodeCheckbox
				checked={showFlatFileView}
				onChange={(e) => {
					// @ts-expect-error
					setShowFlatFileView(Boolean(e.target?.checked));
				}}
			>
				Flat file view
			</VscodeCheckbox>
			<VscodeCheckbox
				checked={showIdiomaticFiles}
				onChange={(e) => {
					// @ts-expect-error
					setShowIdiomaticFiles(Boolean(e.target?.checked));
				}}
			>
				Include idiomatic files
			</VscodeCheckbox>
		</>
	);

	if (showFlatFileView) {
		const configFiles = (projectsQuery.data?.configFiles ?? [])
			.filter((config) => showIdiomaticFiles || !config.idiomatic)
			.filter((config) => matchesToolFilter(Object.keys(config.tools)));

		return (
			<div>
				{scanBar}
				<CustomTable
					style={{ height: windowSize.height - 84 }}
					isLoading={projectsQuery.isLoading}
					filterRowElement={toggles}
					data={configFiles}
					columns={[
						{
							id: "path",
							header: "File",
							// filter/sort on what is displayed, so "~/projects" matches
							accessorFn: (row) => toDisplayPath(row.path),
							cell: ({ row }) => (
								<>
									<FileLink filePath={row.original.path} />
									{row.original.global ? (
										<span style={{ opacity: 0.8, marginLeft: "4px" }}>
											(global)
										</span>
									) : null}
								</>
							),
						},
						{
							id: "tools",
							header: "Tools",
							accessorFn: (row) =>
								Object.entries(row.tools)
									.map(([name, version]) => `${name} = ${version}`)
									.join(" "),
							cell: ({ row }) =>
								Object.entries(row.original.tools).map(([name, version]) => (
									<div key={name}>
										{name} = {version}
									</div>
								)),
						},
					]}
				/>
			</div>
		);
	}

	const projects = (projectsQuery.data?.projects ?? [])
		.map((project) =>
			showIdiomaticFiles
				? project
				: {
						...project,
						configs: project.configs.filter((config) => !config.idiomatic),
						tools: project.tools.filter((tool) => !tool.idiomatic),
					},
		)
		.filter((project) => showIdiomaticFiles || project.hasMiseConfig)
		.filter((project) =>
			matchesToolFilter(project.tools.map((tool) => tool.name)),
		);

	return (
		<div>
			{scanBar}
			<CustomTable
				style={{ height: windowSize.height - 84 }}
				isLoading={projectsQuery.isLoading}
				filterRowElement={toggles}
				data={projects}
				columns={[
					{
						id: "project",
						header: "Project",
						// filter/sort on what is displayed, so "~/projects" matches
						accessorFn: (row) => toDisplayPath(row.rootDir),
						cell: ({ row }) => (
							<div
								style={{ display: "flex", alignItems: "center", gap: "4px" }}
							>
								<IconButton
									iconName="folder-opened"
									title="Open in new window"
									onClick={() =>
										openProjectMutation.mutate(row.original.rootDir)
									}
								/>
								<span>{toDisplayPath(row.original.rootDir)}</span>
							</div>
						),
					},
					{
						id: "configs",
						header: "Config files",
						accessorFn: (row) =>
							row.configs.map((config) => toDisplayPath(config.path)).join(" "),
						cell: ({ row }) =>
							row.original.configs.map((config) => (
								<div key={config.path}>
									<FileLink filePath={config.path} />
								</div>
							)),
					},
					{
						id: "tools",
						header: "Tools",
						accessorFn: (row) =>
							row.tools
								.map((tool) => `${tool.name} = ${tool.version}`)
								.join(" "),
						cell: ({ row }) =>
							row.original.tools.map((tool) => (
								<div
									key={tool.name}
									title={[
										tool.resolvedVersion
											? `Resolved version: ${tool.resolvedVersion}`
											: undefined,
										tool.overridesGlobal
											? `Overrides the global default (${tool.name} = ${tool.globalVersion})`
											: undefined,
									]
										.filter(Boolean)
										.join("\n")}
									style={
										tool.overridesGlobal
											? { color: "var(--vscode-editorWarning-foreground)" }
											: undefined
									}
								>
									{tool.name} = {tool.version}
									{tool.overridesGlobal
										? ` (global: ${tool.globalVersion})`
										: ""}
									{tool.installed === false ? (
										<span
											style={{
												color: "var(--vscode-errorForeground)",
												marginLeft: "4px",
											}}
										>
											(not installed)
										</span>
									) : null}
								</div>
							)),
					},
				]}
			/>
		</div>
	);
};
