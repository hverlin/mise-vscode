import { useQuery } from "@tanstack/react-query";
import {
	VscodeMultiSelect,
	VscodeOption,
} from "@vscode-elements/react-elements";
import { useState } from "react";
import { Graphviz } from "./components/DotRenderer";
import { vscodeClient } from "./webviewVsCodeApi";

export const TasksDependencies = () => {
	const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

	const tasksQuery = useQuery({
		queryKey: ["tasks"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<MiseTask[]>,
	});

	const taskDepsQuery = useQuery({
		queryKey: ["taskDeps", selectedOptions],
		queryFn: () =>
			vscodeClient.request({
				queryKey: ["taskDeps"],
				variables: {
					tasks: selectedOptions.filter((t) =>
						tasksQuery.data?.some((task) => task.name === t),
					),
				},
			}) as Promise<string>,
	});

	const taskDepsDot = taskDepsQuery.data?.split?.("digraph {")[1];

	const dotString = `
digraph {
    rankdir="TB";
    splines=true;
    overlap=false;
    nodesep="0.3";
    ranksep="0.8";
    fontname="Lato";
    graph [ bgcolor="transparent" ]
    node [ shape="plaintext" style="filled, rounded" fontname="Lato" margin=0.2 ]
    edge [ fontname="Lato" color="#aaa" ]

${taskDepsDot}
`;

	return (
		<div>
			<VscodeMultiSelect
				key={tasksQuery.data?.join(",")}
				onChange={(e) => {
					// @ts-ignore
					setSelectedOptions(e.target?.value ?? []);
				}}
			>
				{tasksQuery.data?.map((task) => (
					<VscodeOption key={task.name} value={task.name}>
						{task.name}
					</VscodeOption>
				))}
			</VscodeMultiSelect>
			{taskDepsQuery.isPending ? (
				<div style={{ padding: "10px 0" }}>Loading...</div>
			) : taskDepsQuery.error ? (
				<div style={{ padding: "10px 0" }}>
					Error: {/* @ts-ignore */}
					{taskDepsQuery.error?.stderr ?? JSON.stringify(taskDepsQuery.error)}
				</div>
			) : (
				<Graphviz
					dot={dotString}
					options={{
						engine: "dot",
						convertEqualSidedPolygons: true,
					}}
				/>
			)}
		</div>
	);
};
