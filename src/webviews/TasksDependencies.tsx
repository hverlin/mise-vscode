import { useMutation, useQuery } from "@tanstack/react-query";
import {
	VscodeBadge,
	VscodeButton,
	VscodeCheckbox,
	VscodeMultiSelect,
	VscodeOption,
	VscodeTabHeader,
	VscodeTabPanel,
	VscodeTabs,
} from "@vscode-elements/react-elements";
import {
	type Edge,
	Handle,
	MarkerType,
	type Node,
	type NodeProps,
	Position,
} from "@xyflow/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatTaskOutputs } from "../utils/taskDisplay";
import { DebouncedInput } from "./components/DebouncedInput";
import {
	FlowGraph,
	type LayoutDirection,
	layoutGraph,
	layoutGroupedGraph,
	type NodeFocusRequest,
} from "./components/FlowGraph";
import { IconButton } from "./components/IconButton";
import { useWindowSize } from "./components/UseWindowSize";
import { vscodeClient } from "./webviewVsCodeApi";
import "./tasksGraph.css";

type FlowTask = MiseTask & {
	displayName: string;
	sourceLabel: string;
	projectKey: string;
	projectLabel: string;
};
type TaskGraphEdge = {
	from: string;
	to: string;
	kind: "depends" | "wait_for" | "depends_post";
	optional?: boolean;
};
type TaskFlowGraphData = { tasks: FlowTask[]; edges: TaskGraphEdge[] };
type FlowProject = MiseProject & { manifestPath?: string };

const useOpenTaskDefinitionMutation = () =>
	useMutation({
		mutationKey: ["openTaskDefinition"],
		mutationFn: (taskName: string) =>
			vscodeClient.request({
				mutationKey: ["openTaskDefinition"],
				variables: { taskName },
			}),
	});

const useRunTaskMutation = () =>
	useMutation({
		mutationKey: ["runTask"],
		mutationFn: (taskName: string) =>
			vscodeClient.request({
				mutationKey: ["runTask"],
				variables: { taskName },
			}),
	});

const useToggleMaximizedEditorMutation = () =>
	useMutation({
		mutationKey: ["toggleMaximizedEditor"],
		mutationFn: () =>
			vscodeClient.request({ mutationKey: ["toggleMaximizedEditor"] }),
	});

const useOpenFileMutation = () =>
	useMutation({
		mutationKey: ["openFile"],
		mutationFn: (path: string) =>
			vscodeClient.request({ mutationKey: ["openFile"], variables: { path } }),
	});

const renderDependsEntry = (
	entry: string | string[] | { task: string; optional?: boolean },
) => {
	if (typeof entry === "string") {
		return entry;
	}
	if (Array.isArray(entry)) {
		return entry.join(" ");
	}
	return entry.optional ? `${entry.task} (optional)` : entry.task;
};

/** How much of a task the cards show, like Liam's "show mode" */
type CardDisplayMode = "minimal" | "description" | "run";

/** estimated card height per mode, used by the (pre-render) layout */
const CARD_HEIGHT_ESTIMATE: Record<CardDisplayMode, number> = {
	minimal: 64,
	description: 100,
	run: 190,
};

const CARD_MODE_LABELS: Record<CardDisplayMode, string> = {
	minimal: "Title only",
	description: "Description",
	run: "Description + run",
};

/** Liam-style "show <mode>" dropdown; the popup opens above the toolbar */
function ShowModeMenu({
	mode,
	onChange,
}: {
	mode: CardDisplayMode;
	onChange: (mode: CardDisplayMode) => void;
}) {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (!open) {
			return;
		}
		const close = () => setOpen(false);
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				close();
			}
		};
		window.addEventListener("click", close);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("click", close);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	return (
		<div className="graph-show-menu">
			<span className="graph-show-label">show</span>
			<button
				type="button"
				className="graph-show-button"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={(e) => {
					e.stopPropagation();
					setOpen((value) => !value);
				}}
			>
				{CARD_MODE_LABELS[mode]}
				<i className="codicon codicon-chevron-down" />
			</button>
			{open ? (
				<div className="graph-show-popup" role="menu">
					{(Object.keys(CARD_MODE_LABELS) as CardDisplayMode[]).map((value) => (
						<button
							key={value}
							type="button"
							role="menuitemradio"
							aria-checked={value === mode}
							className="graph-show-item"
							onClick={() => onChange(value)}
						>
							<span>{CARD_MODE_LABELS[value]}</span>
							{value === mode ? <i className="codicon codicon-check" /> : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

function TaskNode({
	data,
	selected,
	sourcePosition,
	targetPosition,
}: NodeProps<Node<{ task: FlowTask; mode: CardDisplayMode }>>) {
	const { task, mode } = data;
	const showRun = mode === "run" && Boolean(task.run?.length);
	const hasBody = mode !== "minimal" && Boolean(task.description || showRun);
	return (
		<div className={`graph-node ${selected ? "graph-node-selected" : ""}`}>
			<Handle type="target" position={targetPosition ?? Position.Top} />
			<div className="graph-node-header">
				<div className="graph-node-title">{task.displayName}</div>
				<div className="graph-node-subtitle">{task.sourceLabel}</div>
				{task.aliases?.length ? (
					<div className="graph-node-aliases">
						alias: {task.aliases.join(", ")}
					</div>
				) : null}
			</div>
			{hasBody ? (
				<div className="graph-node-body">
					{task.description ? (
						<div className="graph-node-detail">{task.description}</div>
					) : null}
					{showRun ? (
						<pre className="graph-node-run nowheel nodrag">
							{task.run?.join("\n")}
						</pre>
					) : null}
				</div>
			) : null}
			<Handle type="source" position={sourcePosition ?? Position.Bottom} />
		</div>
	);
}

function ProjectNode({
	data,
	selected,
	sourcePosition,
	targetPosition,
}: NodeProps<Node<{ project: FlowProject }>>) {
	const { project } = data;
	const [provider, ...rest] = project.id.split(":");
	return (
		<div className={`graph-node ${selected ? "graph-node-selected" : ""}`}>
			<Handle type="target" position={targetPosition ?? Position.Top} />
			<div className="graph-node-header">
				<div className="graph-node-title">
					<VscodeBadge>{provider}</VscodeBadge> {rest.join(":")}
				</div>
			</div>
			<div className="graph-node-body">
				<div className="graph-node-subtitle">{project.root || "."}</div>
			</div>
			<Handle type="source" position={sourcePosition ?? Position.Bottom} />
		</div>
	);
}

function ProjectGroupNode({ data }: NodeProps<Node<{ label: string }>>) {
	return <div className="graph-group-title">{String(data.label)}</div>;
}

const taskNodeTypes = { task: TaskNode, projectGroup: ProjectGroupNode };
const projectNodeTypes = { project: ProjectNode };

function DetailsRow({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	if (!children) {
		return null;
	}
	return (
		<div className="details-row">
			<div className="details-label">{label}</div>
			<div className="details-value">{children}</div>
		</div>
	);
}

type ContextMenuState = { x: number; y: number; taskName: string };

function GraphContextMenu({
	menu,
	onClose,
	actions,
}: {
	menu: ContextMenuState;
	onClose: () => void;
	actions: Array<{ label: string; onClick: () => void }>;
}) {
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("click", onClose);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("click", onClose);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [onClose]);

	return (
		<div
			className="graph-context-menu"
			style={{ left: menu.x, top: menu.y }}
			role="menu"
		>
			{actions.map((action) => (
				<button
					key={action.label}
					type="button"
					role="menuitem"
					className="graph-context-menu-item"
					onClick={() => {
						action.onClick();
						onClose();
					}}
				>
					{action.label}
				</button>
			))}
		</div>
	);
}

/**
 * Sizes itself to the space left below the toolbar, and supports an
 * in-webview full screen mode (a real one is not available to webviews).
 */
function GraphShell({
	expanded,
	onToggleExpanded,
	children,
}: {
	expanded: boolean;
	onToggleExpanded: () => void;
	children: React.ReactNode;
}) {
	const shellRef = useRef<HTMLDivElement>(null);
	const { height: windowHeight } = useWindowSize();
	const [height, setHeight] = useState<number>();

	// biome-ignore lint/correctness/useExhaustiveDependencies: windowHeight triggers a re-measure on window resize
	useLayoutEffect(() => {
		const shell = shellRef.current;
		if (!shell || expanded) {
			return;
		}
		const measure = () => {
			const rect = shell.getBoundingClientRect();
			// a hidden tab panel reports a zero rect, measure once it shows up
			if (rect.width === 0) {
				return;
			}
			setHeight(Math.max(300, window.innerHeight - rect.top - 10));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(shell);
		return () => observer.disconnect();
	}, [windowHeight, expanded]);

	useEffect(() => {
		if (!expanded) {
			return;
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onToggleExpanded();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [expanded, onToggleExpanded]);

	return (
		<div
			ref={shellRef}
			className={`graph-shell ${expanded ? "graph-shell-expanded" : ""}`}
			style={expanded ? undefined : { height }}
		>
			{children}
		</div>
	);
}

function useExpandedGraph() {
	const [expanded, setExpanded] = useState(false);
	const toggleMaximizedEditor = useToggleMaximizedEditorMutation();
	const toggleExpanded = () => {
		setExpanded((value) => !value);
		toggleMaximizedEditor.mutate();
	};
	return { expanded, toggleExpanded };
}

function TaskDetailsPanel({
	task,
	onClose,
	onFilter,
}: {
	task: FlowTask;
	onClose: () => void;
	/** absent when the task is already part of the filter selection */
	onFilter?: () => void;
}) {
	const openTaskDefinition = useOpenTaskDefinitionMutation();
	const runTask = useRunTaskMutation();

	return (
		<aside className="details-panel">
			<div className="details-header">
				<span className="details-title">{task.displayName}</span>
				<button
					type="button"
					className="link-button"
					aria-label="Close details"
					onClick={onClose}
				>
					✕
				</button>
			</div>
			<div className="details-actions">
				<VscodeButton onClick={() => runTask.mutate(task.name)}>
					Run task
				</VscodeButton>
				<VscodeButton
					secondary
					onClick={() => openTaskDefinition.mutate(task.name)}
				>
					Open definition
				</VscodeButton>
				<VscodeButton
					secondary
					title="Show only this task and its dependencies"
					onClick={onFilter}
				>
					Filter
				</VscodeButton>
			</div>
			<DetailsRow label="Name">{task.name}</DetailsRow>
			<DetailsRow label="Aliases">{task.aliases?.join(", ")}</DetailsRow>
			<DetailsRow label="Description">{task.description}</DetailsRow>
			<DetailsRow label="Source">
				<button
					type="button"
					className="link-button"
					onClick={() => openTaskDefinition.mutate(task.name)}
				>
					{task.sourceLabel}
				</button>
			</DetailsRow>
			<DetailsRow label="Directory">{task.dir}</DetailsRow>
			<DetailsRow label="Depends on">
				{task.depends?.map(renderDependsEntry).join(", ")}
			</DetailsRow>
			<DetailsRow label="Waits for">
				{task.wait_for?.map(renderDependsEntry).join(", ")}
			</DetailsRow>
			<DetailsRow label="Post-depends on">
				{task.depends_post?.map(renderDependsEntry).join(", ")}
			</DetailsRow>
			<DetailsRow label="Sources">{task.sources?.join(", ")}</DetailsRow>
			<DetailsRow label="Outputs">{formatTaskOutputs(task.outputs)}</DetailsRow>
			{task.run?.length ? (
				<div className="details-row">
					<div className="details-label">Run</div>
					<pre className="details-code">{task.run.join("\n")}</pre>
				</div>
			) : null}
		</aside>
	);
}

function ProjectDetailsPanel({
	project,
	projects,
	onClose,
	onSelectProject,
}: {
	project: FlowProject;
	projects: FlowProject[];
	onClose: () => void;
	onSelectProject: (id: string) => void;
}) {
	const openFile = useOpenFileMutation();
	const dependents = projects
		.filter((p) => p.dependencies?.includes(project.id))
		.map((p) => p.id);

	return (
		<aside className="details-panel">
			<div className="details-header">
				<span className="details-title">{project.id}</span>
				<button
					type="button"
					className="link-button"
					aria-label="Close details"
					onClick={onClose}
				>
					✕
				</button>
			</div>
			<DetailsRow label="Root">{project.root || "."}</DetailsRow>
			<DetailsRow label="Provider">{project.provenance?.provider}</DetailsRow>
			<DetailsRow label="Manifest">
				{project.manifestPath ? (
					<button
						type="button"
						className="link-button"
						onClick={() =>
							project.manifestPath && openFile.mutate(project.manifestPath)
						}
					>
						{project.provenance?.source ??
							project.metadata?.workspace_source ??
							project.manifestPath}
					</button>
				) : (
					(project.metadata?.workspace_source ?? "")
				)}
			</DetailsRow>
			<DetailsRow label="Depends on">
				{project.dependencies?.length
					? project.dependencies.map((id) => (
							<button
								key={id}
								type="button"
								className="link-button details-list-item"
								onClick={() => onSelectProject(id)}
							>
								{id}
							</button>
						))
					: null}
			</DetailsRow>
			<DetailsRow label="Depended on by">
				{dependents.length
					? dependents.map((id) => (
							<button
								key={id}
								type="button"
								className="link-button details-list-item"
								onClick={() => onSelectProject(id)}
							>
								{id}
							</button>
						))
					: null}
			</DetailsRow>
		</aside>
	);
}

/**
 * Selected tasks plus their transitive dependencies and dependents (but not
 * the whole connected component: a dependent's other dependencies stay out).
 */
function getVisibleTaskNames(
	selection: string[],
	edges: TaskGraphEdge[],
): Set<string> | undefined {
	if (!selection.length) {
		return undefined;
	}
	const visible = new Set(selection);
	const walk = (
		follow: (edge: TaskGraphEdge, current: string) => string | undefined,
	) => {
		const queue = [...selection];
		const seen = new Set(selection);
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current) {
				continue;
			}
			for (const edge of edges) {
				const next = follow(edge, current);
				if (next && !seen.has(next)) {
					seen.add(next);
					visible.add(next);
					queue.push(next);
				}
			}
		}
	};
	walk((edge, current) => (edge.from === current ? edge.to : undefined));
	walk((edge, current) => (edge.to === current ? edge.from : undefined));
	return visible;
}

const edgeStyleForKind = (edge: TaskGraphEdge): Partial<Edge> => {
	const style: React.CSSProperties = {};
	let label: string | undefined;
	if (edge.kind === "wait_for") {
		style.strokeDasharray = "7 4";
		label = "wait for";
	} else if (edge.kind === "depends_post") {
		style.strokeDasharray = "2 4";
		label = "post";
	}
	if (edge.optional) {
		style.opacity = 0.6;
		label = label ? `${label}, optional` : "optional";
	}
	return { style, label };
};

/** Dim everything not connected to the selection to make its edges stand out */
const highlightClassName = (
	hasSelection: boolean,
	touchesSelection: boolean,
) => {
	if (!hasSelection) {
		return undefined;
	}
	return touchesSelection ? "edge-highlighted" : "edge-dimmed";
};

const matchesSearch = (task: FlowTask, term: string) =>
	[
		task.name,
		task.displayName,
		task.sourceLabel,
		task.description,
		...(task.aliases ?? []),
	]
		.filter(Boolean)
		.some((value) => value?.toLowerCase().includes(term));

const TaskDepsGraph = () => {
	const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
	const [selectedTaskNames, setSelectedTaskNames] = useState<string[]>([]);
	const [direction, setDirection] = useState<LayoutDirection>("TB");
	const [onlyConnected, setOnlyConnected] = useState(false);
	const [groupByProject, setGroupByProject] = useState(true);
	const [displayMode, setDisplayMode] =
		useState<CardDisplayMode>("description");
	const [searchTerm, setSearchTerm] = useState("");
	const [focus, setFocus] = useState<NodeFocusRequest | undefined>();
	const [contextMenu, setContextMenu] = useState<
		ContextMenuState | undefined
	>();
	const { expanded, toggleExpanded } = useExpandedGraph();
	const openTaskDefinition = useOpenTaskDefinitionMutation();
	const runTask = useRunTaskMutation();

	const graphQuery = useQuery({
		queryKey: ["taskFlowGraph"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<TaskFlowGraphData>,
	});

	const tasks = graphQuery.data?.tasks ?? [];
	const graphEdges = graphQuery.data?.edges ?? [];
	// grouping only makes sense with several projects
	const hasMultipleProjects = new Set(tasks.map((t) => t.projectKey)).size > 1;
	const groupingEnabled = groupByProject && hasMultipleProjects;

	const { nodes, edges, searchMatches } = useMemo(() => {
		const visibleNames = getVisibleTaskNames(selectedOptions, graphEdges);
		let visibleTasks = visibleNames
			? tasks.filter((t) => visibleNames.has(t.name))
			: tasks;
		const visibleEdges = graphEdges.filter(
			(e) =>
				!visibleNames || (visibleNames.has(e.from) && visibleNames.has(e.to)),
		);
		if (onlyConnected) {
			const connected = new Set(visibleEdges.flatMap((e) => [e.from, e.to]));
			visibleTasks = visibleTasks.filter((t) => connected.has(t.name));
		}

		const term = searchTerm.trim().toLowerCase();
		const searchMatches = term
			? visibleTasks.filter((t) => matchesSearch(t, term)).map((t) => t.name)
			: undefined;
		const searchMatchSet = searchMatches ? new Set(searchMatches) : undefined;

		const selectedSet = new Set(selectedTaskNames);
		const neighbors = new Set<string>(selectedTaskNames);
		for (const edge of visibleEdges) {
			if (selectedSet.has(edge.from)) {
				neighbors.add(edge.to);
			}
			if (selectedSet.has(edge.to)) {
				neighbors.add(edge.from);
			}
		}

		const flowEdges: Edge[] = visibleEdges.map((edge) => ({
			id: `${edge.kind}:${edge.from}->${edge.to}`,
			source: edge.from,
			target: edge.to,
			markerEnd: { type: MarkerType.ArrowClosed },
			...edgeStyleForKind(edge),
			className: highlightClassName(
				selectedSet.size > 0,
				selectedSet.has(edge.from) || selectedSet.has(edge.to),
			),
		}));
		const taskNodes: Node[] = visibleTasks.map((task) => {
			const dimmed =
				(selectedSet.size > 0 && !neighbors.has(task.name)) ||
				(searchMatchSet && !searchMatchSet.has(task.name));
			const classNames = [
				dimmed ? "graph-node-dimmed" : "",
				searchMatchSet?.has(task.name) ? "graph-node-match" : "",
			]
				.filter(Boolean)
				.join(" ");
			return {
				id: task.name,
				type: "task",
				position: { x: 0, y: 0 },
				selected: selectedSet.has(task.name),
				className: classNames || undefined,
				data: { task, mode: displayMode },
			};
		});
		const nodeHeight = CARD_HEIGHT_ESTIMATE[displayMode];
		const flowNodes = groupingEnabled
			? layoutGroupedGraph(
					taskNodes,
					flowEdges,
					direction,
					(node) => {
						const { task } = node.data as { task: FlowTask };
						return { key: task.projectKey, label: task.projectLabel };
					},
					nodeHeight,
				)
			: layoutGraph(taskNodes, flowEdges, direction, nodeHeight);
		return { nodes: flowNodes, edges: flowEdges, searchMatches };
	}, [
		tasks,
		graphEdges,
		selectedOptions,
		selectedTaskNames,
		onlyConnected,
		groupingEnabled,
		searchTerm,
		direction,
		displayMode,
	]);

	const selectedTask =
		selectedTaskNames.length === 1
			? tasks.find((t) => t.name === selectedTaskNames[0])
			: undefined;

	const handleSelect = (
		taskName: string | undefined,
		event?: React.MouseEvent,
	) => {
		if (!taskName) {
			setSelectedTaskNames([]);
			return;
		}
		const additive = event?.metaKey || event?.ctrlKey || event?.shiftKey;
		setSelectedTaskNames((current) => {
			if (!additive) {
				return [taskName];
			}
			return current.includes(taskName)
				? current.filter((name) => name !== taskName)
				: [...current, taskName];
		});
	};

	if (graphQuery.isPending) {
		return <div style={{ padding: "10px 0" }}>Loading...</div>;
	}
	if (graphQuery.error) {
		return (
			<div style={{ padding: "10px 0" }}>
				Error: {JSON.stringify(graphQuery.error)}
			</div>
		);
	}

	const focusFirstMatch = () => {
		const [firstMatch] = searchMatches ?? [];
		if (firstMatch) {
			setSelectedTaskNames([firstMatch]);
			setFocus((f) => ({ nodeId: firstMatch, token: (f?.token ?? 0) + 1 }));
		}
	};

	return (
		<div className="graph-page">
			<div className="graph-toolbar">
				<div className="graph-toolbar-search">
					<DebouncedInput
						placeholder="Search tasks"
						value={searchTerm}
						onChange={(value) => setSearchTerm(String(value))}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								focusFirstMatch();
							}
						}}
					/>
					{searchMatches ? (
						<span className="graph-search-count">
							{searchMatches.length}{" "}
							{searchMatches.length === 1 ? "match" : "matches"}
						</span>
					) : null}
				</div>
				<div className="graph-toolbar-grow">
					<VscodeMultiSelect
						key={tasks.map((t) => t.name).join(",")}
						value={selectedOptions}
						onChange={(e) => {
							// @ts-expect-error
							setSelectedOptions(e.target?.value ?? []);
						}}
					>
						{tasks.map((task) => (
							<VscodeOption key={task.name} value={task.name}>
								{task.name}
							</VscodeOption>
						))}
					</VscodeMultiSelect>
				</div>
				{hasMultipleProjects ? (
					<VscodeCheckbox
						checked={groupByProject}
						onChange={(e) => {
							// @ts-expect-error
							setGroupByProject(Boolean(e.target?.checked));
						}}
					>
						Group by project
					</VscodeCheckbox>
				) : null}
				<VscodeCheckbox
					checked={onlyConnected}
					onChange={(e) => {
						// @ts-expect-error
						setOnlyConnected(Boolean(e.target?.checked));
					}}
				>
					Only tasks with dependencies
				</VscodeCheckbox>
				<IconButton
					iconName={expanded ? "screen-normal" : "screen-full"}
					title="Toggle full screen"
					onClick={toggleExpanded}
				/>
			</div>
			<GraphShell expanded={expanded} onToggleExpanded={toggleExpanded}>
				<div className="graph-canvas">
					<FlowGraph
						nodes={nodes}
						edges={edges}
						nodeTypes={taskNodeTypes}
						onSelect={handleSelect}
						onNodeContextMenu={(event, taskName) => {
							event.preventDefault();
							// right-clicking within a multi-selection keeps it
							setSelectedTaskNames((current) =>
								current.includes(taskName) ? current : [taskName],
							);
							setContextMenu({
								x: event.clientX,
								y: event.clientY,
								taskName,
							});
						}}
						focus={focus}
						direction={direction}
						onDirectionChange={setDirection}
						toolbarExtra={
							<ShowModeMenu mode={displayMode} onChange={setDisplayMode} />
						}
						refitSignal={[
							direction,
							groupingEnabled,
							onlyConnected,
							expanded,
							displayMode,
							selectedOptions.join("|"),
						].join(";")}
					/>
				</div>
				{expanded ? (
					<IconButton
						className="graph-exit-expand"
						iconName="screen-normal"
						title="Exit full screen (Esc)"
						onClick={toggleExpanded}
					/>
				) : null}
				{selectedTask ? (
					<TaskDetailsPanel
						task={selectedTask}
						onClose={() => setSelectedTaskNames([])}
						onFilter={
							selectedOptions.includes(selectedTask.name)
								? undefined
								: () => setSelectedOptions([selectedTask.name])
						}
					/>
				) : null}
				{selectedTaskNames.length > 1 ? (
					<div className="details-panel graph-selection-bar">
						<span>{selectedTaskNames.length} tasks selected</span>
						<VscodeButton onClick={() => setSelectedOptions(selectedTaskNames)}>
							Filter
						</VscodeButton>
						<VscodeButton secondary onClick={() => setSelectedTaskNames([])}>
							Clear
						</VscodeButton>
					</div>
				) : null}
				{contextMenu ? (
					<GraphContextMenu
						menu={contextMenu}
						onClose={() => setContextMenu(undefined)}
						actions={[
							{
								label: "Run task",
								onClick: () => runTask.mutate(contextMenu.taskName),
							},
							{
								label: "Open definition",
								onClick: () => openTaskDefinition.mutate(contextMenu.taskName),
							},
							{
								label:
									selectedTaskNames.length > 1 &&
									selectedTaskNames.includes(contextMenu.taskName)
										? "Filter on selected tasks"
										: "Filter on this task",
								onClick: () =>
									setSelectedOptions(
										selectedTaskNames.length > 1 &&
											selectedTaskNames.includes(contextMenu.taskName)
											? selectedTaskNames
											: [contextMenu.taskName],
									),
							},
						]}
					/>
				) : null}
			</GraphShell>
		</div>
	);
};

const WorkspaceProjectsGraph = ({ projects }: { projects: FlowProject[] }) => {
	const [selectedProjectId, setSelectedProjectId] = useState<
		string | undefined
	>();
	const [direction, setDirection] = useState<LayoutDirection>("TB");
	const [searchTerm, setSearchTerm] = useState("");
	const [focus, setFocus] = useState<NodeFocusRequest | undefined>();
	const { expanded, toggleExpanded } = useExpandedGraph();

	const selectAndFocus = (id: string) => {
		setSelectedProjectId(id);
		setFocus((f) => ({ nodeId: id, token: (f?.token ?? 0) + 1 }));
	};

	const { nodes, edges, searchMatches } = useMemo(() => {
		const term = searchTerm.trim().toLowerCase();
		const searchMatches = term
			? projects
					.filter(
						(p) =>
							p.id.toLowerCase().includes(term) ||
							p.root.toLowerCase().includes(term),
					)
					.map((p) => p.id)
			: undefined;
		const searchMatchSet = searchMatches ? new Set(searchMatches) : undefined;

		const neighbors = new Set<string>();
		if (selectedProjectId) {
			neighbors.add(selectedProjectId);
			for (const project of projects) {
				for (const dependency of project.dependencies ?? []) {
					if (project.id === selectedProjectId) {
						neighbors.add(dependency);
					}
					if (dependency === selectedProjectId) {
						neighbors.add(project.id);
					}
				}
			}
		}

		const flowEdges: Edge[] = projects.flatMap((project) =>
			(project.dependencies ?? []).map((dependency) => ({
				id: `${project.id}->${dependency}`,
				source: project.id,
				target: dependency,
				markerEnd: { type: MarkerType.ArrowClosed },
				className: highlightClassName(
					Boolean(selectedProjectId),
					project.id === selectedProjectId || dependency === selectedProjectId,
				),
			})),
		);
		const flowNodes: Node[] = layoutGraph(
			projects.map((project) => {
				const dimmed =
					(selectedProjectId && !neighbors.has(project.id)) ||
					(searchMatchSet && !searchMatchSet.has(project.id));
				const classNames = [
					dimmed ? "graph-node-dimmed" : "",
					searchMatchSet?.has(project.id) ? "graph-node-match" : "",
				]
					.filter(Boolean)
					.join(" ");
				return {
					id: project.id,
					type: "project",
					position: { x: 0, y: 0 },
					selected: project.id === selectedProjectId,
					className: classNames || undefined,
					data: { project },
				};
			}),
			flowEdges,
			direction,
		);
		return { nodes: flowNodes, edges: flowEdges, searchMatches };
	}, [projects, selectedProjectId, searchTerm, direction]);

	const selectedProject = projects.find((p) => p.id === selectedProjectId);

	return (
		<div className="graph-page">
			<div className="graph-toolbar">
				<div className="graph-toolbar-search">
					<DebouncedInput
						placeholder="Search projects"
						value={searchTerm}
						onChange={(value) => setSearchTerm(String(value))}
						onKeyDown={(e) => {
							const [firstMatch] = searchMatches ?? [];
							if (e.key === "Enter" && firstMatch) {
								selectAndFocus(firstMatch);
							}
						}}
					/>
					{searchMatches ? (
						<span className="graph-search-count">
							{searchMatches.length}{" "}
							{searchMatches.length === 1 ? "match" : "matches"}
						</span>
					) : null}
				</div>
				<div className="graph-toolbar-grow" />
				<IconButton
					iconName={expanded ? "screen-normal" : "screen-full"}
					title="Toggle full screen"
					onClick={toggleExpanded}
				/>
			</div>
			<GraphShell expanded={expanded} onToggleExpanded={toggleExpanded}>
				<div className="graph-canvas">
					<FlowGraph
						nodes={nodes}
						edges={edges}
						nodeTypes={projectNodeTypes}
						onSelect={setSelectedProjectId}
						focus={focus}
						direction={direction}
						onDirectionChange={setDirection}
						refitSignal={[direction, expanded].join(";")}
					/>
				</div>
				{expanded ? (
					<IconButton
						className="graph-exit-expand"
						iconName="screen-normal"
						title="Exit full screen (Esc)"
						onClick={toggleExpanded}
					/>
				) : null}
				{selectedProject ? (
					<ProjectDetailsPanel
						project={selectedProject}
						projects={projects}
						onClose={() => setSelectedProjectId(undefined)}
						onSelectProject={selectAndFocus}
					/>
				) : null}
			</GraphShell>
		</div>
	);
};

export const TasksDependencies = () => {
	// the graph manages its own viewport, the page itself must not scroll
	useEffect(() => {
		document.body.classList.add("graph-view");
		return () => document.body.classList.remove("graph-view");
	}, []);

	const projectsQuery = useQuery({
		queryKey: ["tasksGraph"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<FlowProject[]>,
	});

	if (!projectsQuery.data?.length) {
		return (
			<div className="graph-standalone">
				<TaskDepsGraph />
			</div>
		);
	}

	return (
		<VscodeTabs>
			<VscodeTabHeader slot="header">Task dependencies</VscodeTabHeader>
			<VscodeTabPanel>
				<TaskDepsGraph />
			</VscodeTabPanel>
			<VscodeTabHeader slot="header">Workspace projects</VscodeTabHeader>
			<VscodeTabPanel>
				<WorkspaceProjectsGraph projects={projectsQuery.data} />
			</VscodeTabPanel>
		</VscodeTabs>
	);
};
