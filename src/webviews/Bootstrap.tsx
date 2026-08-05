import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VscodeButton, VscodeCheckbox } from "@vscode-elements/react-elements";
import { useState } from "react";
import {
	BOOTSTRAP_NEUTRAL_STATES,
	BOOTSTRAP_OK_STATES,
	type BootstrapEntry,
	getBootstrapSections,
} from "../utils/bootstrapUtils";
import CustomTable from "./components/CustomTable";
import { IconButton } from "./components/IconButton";
import { useWindowSize } from "./components/UseWindowSize";
import { vscodeClient } from "./webviewVsCodeApi";

type BootstrapRow = {
	section: string;
	label: string;
	description?: string;
	tooltip?: string;
	state: string;
	definition: BootstrapEntry["definition"];
	alternates?: BootstrapEntry["alternates"];
};

const StateCell = ({ state }: { state: string }) => {
	const icon = BOOTSTRAP_OK_STATES.has(state)
		? "check"
		: BOOTSTRAP_NEUTRAL_STATES.has(state)
			? "circle-slash"
			: "alert";

	return (
		<span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
			<i className={`codicon codicon-${icon}`} />
			{state}
		</span>
	);
};

export const Bootstrap = () => {
	const queryClient = useQueryClient();
	const windowSize = useWindowSize();
	const [pendingOnly, setPendingOnly] = useState(false);

	const statusQuery = useQuery({
		queryKey: ["bootstrapStatus"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<
				MiseBootstrapStatus | undefined
			>,
	});

	const runBootstrapMutation = useMutation({
		mutationKey: ["runBootstrap"],
		mutationFn: ({ dryRun }: { dryRun: boolean }) =>
			vscodeClient.request({
				mutationKey: ["runBootstrap"],
				variables: { dryRun },
			}),
	});

	const runPlanMutation = useMutation({
		mutationKey: ["runBootstrapPlan"],
		mutationFn: () =>
			vscodeClient.request({ mutationKey: ["runBootstrapPlan"] }),
	});

	const openDefinitionMutation = useMutation({
		mutationKey: ["openBootstrapEntryDefinition"],
		mutationFn: (entry: BootstrapRow) =>
			vscodeClient.request({
				mutationKey: ["openBootstrapEntryDefinition"],
				variables: { entry },
			}),
	});

	if (statusQuery.isError) {
		return <div>Error: {statusQuery.error.message}</div>;
	}

	if (!statusQuery.isLoading && !statusQuery.data) {
		return (
			<div style={{ padding: "10px" }}>
				<a href="https://mise.jdx.dev/bootstrap.html">mise bootstrap</a>{" "}
				requires mise 2026.7.16 or later.
			</div>
		);
	}

	const status = statusQuery.data;
	const sections = status ? getBootstrapSections(status) : [];

	const rows: BootstrapRow[] = sections.flatMap((section) =>
		section.entries
			.filter(
				(entry) =>
					!pendingOnly ||
					(!BOOTSTRAP_OK_STATES.has(entry.state) &&
						!BOOTSTRAP_NEUTRAL_STATES.has(entry.state)),
			)
			.map((entry) => ({
				section: section.label,
				label: entry.label,
				description: entry.description,
				tooltip: entry.tooltip,
				state: entry.state,
				definition: entry.definition,
				alternates: entry.alternates,
			})),
	);

	const runBootstrap = (dryRun: boolean) =>
		runBootstrapMutation.mutate(
			{ dryRun },
			{
				onSettled: () =>
					queryClient.invalidateQueries({ queryKey: ["bootstrapStatus"] }),
			},
		);

	return (
		<div>
			<CustomTable
				style={{ height: windowSize.height - 40 }}
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
							label={"Pending only"}
							checked={pendingOnly}
							onChange={(_e) => {
								setPendingOnly(!pendingOnly);
							}}
						/>
						<VscodeButton
							disabled={runBootstrapMutation.isPending}
							title={"Run mise bootstrap --yes"}
							onClick={() => runBootstrap(false)}
						>
							{runBootstrapMutation.isPending
								? "Running..."
								: "Run mise bootstrap"}
						</VscodeButton>
						<VscodeButton
							secondary
							disabled={runBootstrapMutation.isPending}
							title={"Run mise bootstrap --dry-run"}
							onClick={() => runBootstrap(true)}
						>
							Dry run
						</VscodeButton>
						<VscodeButton
							secondary
							disabled={runPlanMutation.isPending}
							title={
								"Run mise bootstrap plan (preview declarative resource changes, requires mise 2026.8.2+)"
							}
							onClick={() => runPlanMutation.mutate()}
						>
							Plan
						</VscodeButton>
					</div>
				}
				isLoading={statusQuery.isLoading}
				data={rows}
				columns={[
					{
						id: "section",
						header: "Section",
						accessorKey: "section",
					},
					{
						id: "label",
						header: "Item",
						accessorKey: "label",
						cell: ({ row }) => (
							// biome-ignore lint/a11y/useValidAnchor: consistent with Tools.tsx
							<a
								href="#"
								title={row.original.tooltip}
								onClick={() => openDefinitionMutation.mutate(row.original)}
							>
								{row.original.label}
							</a>
						),
					},
					{
						id: "description",
						header: "Details",
						accessorKey: "description",
					},
					{
						id: "state",
						header: "State",
						accessorKey: "state",
						cell: ({ row }) => <StateCell state={row.original.state} />,
					},
				]}
			/>
		</div>
	);
};
