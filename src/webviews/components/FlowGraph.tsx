import dagre from "@dagrejs/dagre";
import {
	Background,
	BaseEdge,
	type Edge,
	type EdgeProps,
	EdgeText,
	getBezierPath,
	type Node,
	type NodeTypes,
	Panel,
	Position,
	ReactFlow,
	useReactFlow,
	useStore,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";

/** A request to bring a node into view (token distinguishes repeats) */
export type NodeFocusRequest = { nodeId: string; token: number };

function FitOnFocus({ focus }: { focus?: NodeFocusRequest }) {
	const { fitView } = useReactFlow();
	useEffect(() => {
		if (focus) {
			fitView({ nodes: [{ id: focus.nodeId }], duration: 250, maxZoom: 1 });
		}
	}, [focus, fitView]);
	return null;
}

/**
 * The initial `fitView` is a no-op while the canvas has no size (e.g. in a
 * hidden tab panel): fit again once dimensions appear, and when the layout
 * changes (direction, grouping, filters).
 */
function FitOnChange({ signal }: { signal?: string }) {
	const { fitView } = useReactFlow();
	const width = useStore((s) => s.width);
	const height = useStore((s) => s.height);
	const lastFit = useRef<{ width: number; height: number } | null>(null);

	// react-flow measures the updated nodes after the commit, fitting right
	// away would compute the bounds of the previous layout
	const fitSoon = useCallback(
		(duration: number) => {
			const frame = requestAnimationFrame(() => {
				requestAnimationFrame(() => fitView({ maxZoom: 1, duration }));
			});
			return () => cancelAnimationFrame(frame);
		},
		[fitView],
	);

	// fit when the canvas gets its dimensions (e.g. its tab panel shows up),
	// and again when they change substantially (e.g. panel resize)
	useEffect(() => {
		if (width <= 0 || height <= 0) {
			return;
		}
		const last = lastFit.current;
		if (
			!last ||
			Math.abs(last.width - width) > 120 ||
			Math.abs(last.height - height) > 120
		) {
			lastFit.current = { width, height };
			return fitSoon(last ? 200 : 0);
		}
	}, [width, height, fitSoon]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refit only when the layout signal changes
	useEffect(() => {
		if (lastFit.current) {
			return fitSoon(200);
		}
	}, [signal]);

	return null;
}

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 100;
const GRID_GAP_X = 24;
const GRID_GAP_Y = 20;
const GROUP_PADDING = 14;
const GROUP_TITLE_HEIGHT = 30;

export type LayoutDirection = "TB" | "LR";

const handlePositions = (direction: LayoutDirection) =>
	direction === "LR"
		? { targetPosition: Position.Left, sourcePosition: Position.Right }
		: { targetPosition: Position.Top, sourcePosition: Position.Bottom };

/**
 * Layout runs before the cards are measured, so it works with an estimated
 * height; callers can raise the estimate when cards render more content.
 */
const nodeSize = (node: Node, estimatedHeight: number = NODE_HEIGHT) => ({
	width: (node.width as number | undefined) ?? NODE_WIDTH,
	height: (node.height as number | undefined) ?? estimatedHeight,
});

/**
 * react-flow hides a node until it knows its size, and it reads that size off
 * the node object we hand it. Rebuilding the nodes (hover highlight, search,
 * filters) hands it fresh objects whose `measured` is empty, so without a
 * fallback size every card blinks until the resize observer catches up. The
 * layout estimate is that fallback; `measured` still wins once it lands.
 */
const estimatedDimensions = (width: number, height: number) => ({
	initialWidth: width,
	initialHeight: height,
});

/**
 * Position nodes as a DAG (react-flow has no layout engine). Nodes without
 * any edge would all end up in one endless dagre rank, so they are packed
 * into a grid below the connected graph instead.
 */
export function layoutGraph<NodeType extends Node>(
	nodes: NodeType[],
	edges: Edge[],
	direction: LayoutDirection = "TB",
	nodeHeight: number = NODE_HEIGHT,
): NodeType[] {
	const connectedIds = new Set(edges.flatMap((e) => [e.source, e.target]));
	const connected = nodes.filter((n) => connectedIds.has(n.id));
	const isolated = nodes.filter((n) => !connectedIds.has(n.id));

	const graph = new dagre.graphlib.Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({ rankdir: direction, nodesep: 40, ranksep: 80 });
	for (const node of connected) {
		graph.setNode(node.id, nodeSize(node, nodeHeight));
	}
	for (const edge of edges) {
		if (connectedIds.has(edge.source) && connectedIds.has(edge.target)) {
			graph.setEdge(edge.source, edge.target);
		}
	}
	dagre.layout(graph);

	const positionedConnected = connected.map((node) => {
		const { x, y } = graph.node(node.id);
		const { width, height } = nodeSize(node, nodeHeight);
		return {
			...node,
			...handlePositions(direction),
			...estimatedDimensions(width, height),
			position: { x: x - width / 2, y: y - height / 2 },
		};
	});

	let gridStartY = 0;
	for (const node of positionedConnected) {
		gridStartY = Math.max(
			gridStartY,
			node.position.y + nodeSize(node, nodeHeight).height + 80,
		);
	}

	// simple row-based packing (isolated nodes may have different sizes)
	const columns = Math.max(2, Math.ceil(Math.sqrt(isolated.length)));
	let cursorX = 0;
	let cursorY = gridStartY;
	let rowHeight = 0;
	const positionedIsolated = isolated.map((node, index) => {
		const { width, height } = nodeSize(node, nodeHeight);
		if (index > 0 && index % columns === 0) {
			cursorX = 0;
			cursorY += rowHeight + GRID_GAP_Y;
			rowHeight = 0;
		}
		const position = { x: cursorX, y: cursorY };
		cursorX += width + GRID_GAP_X;
		rowHeight = Math.max(rowHeight, height);
		return {
			...node,
			...handlePositions(direction),
			...estimatedDimensions(width, height),
			position,
		};
	});

	return [...positionedConnected, ...positionedIsolated];
}

/**
 * Two-level layout: nodes of the same group are laid out together inside a
 * group container, then the group containers are laid out as their own
 * graph. Cross-group edges stay attached to the inner nodes.
 */
export function layoutGroupedGraph<NodeType extends Node>(
	nodes: NodeType[],
	edges: Edge[],
	direction: LayoutDirection,
	getGroup: (node: NodeType) => { key: string; label: string },
	nodeHeight: number = NODE_HEIGHT,
): Node[] {
	const groups = new Map<string, { label: string; members: NodeType[] }>();
	for (const node of nodes) {
		const { key, label } = getGroup(node);
		const group = groups.get(key) ?? { label, members: [] };
		group.members.push(node);
		groups.set(key, group);
	}

	const groupIdOf = new Map<string, string>();
	for (const [key, group] of groups) {
		for (const member of group.members) {
			groupIdOf.set(member.id, `group:${key}`);
		}
	}

	const sizedGroups = new Map<
		string,
		{ label: string; width: number; height: number; children: Node[] }
	>();
	for (const [key, group] of groups) {
		const memberIds = new Set(group.members.map((m) => m.id));
		const innerEdges = edges.filter(
			(e) => memberIds.has(e.source) && memberIds.has(e.target),
		);
		const laidOut = layoutGraph(
			group.members,
			innerEdges,
			direction,
			nodeHeight,
		);

		let maxX = 0;
		let maxY = 0;
		for (const node of laidOut) {
			const { width, height } = nodeSize(node, nodeHeight);
			maxX = Math.max(maxX, node.position.x + width);
			maxY = Math.max(maxY, node.position.y + height);
		}
		sizedGroups.set(`group:${key}`, {
			label: group.label,
			width: maxX + GROUP_PADDING * 2,
			height: maxY + GROUP_PADDING + GROUP_TITLE_HEIGHT,
			children: laidOut.map((node) => ({
				...node,
				parentId: `group:${key}`,
				extent: "parent" as const,
				position: {
					x: node.position.x + GROUP_PADDING,
					y: node.position.y + GROUP_TITLE_HEIGHT,
				},
			})),
		});
	}

	// aggregated edges between groups drive the outer layout
	const groupEdges: Edge[] = [];
	const seenGroupEdges = new Set<string>();
	for (const edge of edges) {
		const sourceGroup = groupIdOf.get(edge.source);
		const targetGroup = groupIdOf.get(edge.target);
		if (!sourceGroup || !targetGroup || sourceGroup === targetGroup) {
			continue;
		}
		const key = `${sourceGroup}->${targetGroup}`;
		if (!seenGroupEdges.has(key)) {
			seenGroupEdges.add(key);
			groupEdges.push({ id: key, source: sourceGroup, target: targetGroup });
		}
	}

	const groupNodes: Node[] = layoutGraph(
		[...sizedGroups.entries()].map(([id, group]) => ({
			id,
			type: "projectGroup",
			position: { x: 0, y: 0 },
			width: group.width,
			height: group.height,
			data: { label: group.label },
		})),
		groupEdges,
		direction,
	);

	// parents must come before their children for react-flow
	return [
		...groupNodes,
		...groupNodes.flatMap(
			(groupNode) => sizedGroups.get(groupNode.id)?.children ?? [],
		),
	];
}

/**
 * Default bezier edge plus a sparkle that travels along the path. The
 * sparkle only shows while the edge is highlighted (CSS, tasksGraph.css),
 * keeping the line itself solid.
 */
function SparkleEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	style,
	markerEnd,
	label,
}: EdgeProps) {
	const [path, labelX, labelY] = getBezierPath({
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
	});
	// CSS motion path, not SMIL <animateMotion>: Chromium freezes SMIL
	// animations for good when React re-creates the SVG elements (e.g. on
	// search), while a CSS animation restarts whenever the sparkle shows up
	const sparkleStyle: React.CSSProperties = { offsetPath: `path("${path}")` };
	return (
		<>
			<BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
			{label ? <EdgeText x={labelX} y={labelY} label={label} /> : null}
			<circle className="edge-sparkle-halo" r={6} style={sparkleStyle} />
			<circle className="edge-sparkle" r={2.5} style={sparkleStyle} />
		</>
	);
}

const edgeTypes = { default: SparkleEdge };

/**
 * Liam-style floating toolbar at the bottom of the canvas: zoom controls,
 * fit view, layout direction, plus an optional graph-specific section
 * (e.g. the card display mode menu).
 */
function BottomToolbar({
	direction,
	onDirectionChange,
	extra,
}: {
	direction: LayoutDirection;
	onDirectionChange: (direction: LayoutDirection) => void;
	extra?: React.ReactNode;
}) {
	const { zoomIn, zoomOut, fitView } = useReactFlow();
	const zoom = useStore((s) => s.transform[2]);
	return (
		<Panel position="bottom-center" className="graph-bottom-toolbar">
			<button
				type="button"
				className="graph-toolbar-button"
				title="Zoom out"
				onClick={() => zoomOut({ duration: 150 })}
			>
				<i className="codicon codicon-remove" />
			</button>
			<span className="graph-zoom-level">{Math.round(zoom * 100)}%</span>
			<button
				type="button"
				className="graph-toolbar-button"
				title="Zoom in"
				onClick={() => zoomIn({ duration: 150 })}
			>
				<i className="codicon codicon-add" />
			</button>
			<span className="graph-toolbar-separator" />
			<button
				type="button"
				className="graph-toolbar-button"
				title="Fit view"
				onClick={() => fitView({ duration: 200, maxZoom: 1 })}
			>
				<i className="codicon codicon-target" />
			</button>
			<button
				type="button"
				className={`graph-toolbar-button ${
					direction === "TB" ? "graph-toolbar-button-active" : ""
				}`}
				title="Vertical layout"
				onClick={() => onDirectionChange("TB")}
			>
				<i className="codicon codicon-arrow-down" />
			</button>
			<button
				type="button"
				className={`graph-toolbar-button ${
					direction === "LR" ? "graph-toolbar-button-active" : ""
				}`}
				title="Horizontal layout"
				onClick={() => onDirectionChange("LR")}
			>
				<i className="codicon codicon-arrow-right" />
			</button>
			{extra ? (
				<>
					<span className="graph-toolbar-separator" />
					{extra}
				</>
			) : null}
		</Panel>
	);
}

const appendClassName = (current: string | undefined, extra: string) =>
	current ? `${current} ${extra}` : extra;

/**
 * Hovering a node spotlights it: the node, its direct neighbors and their
 * connecting edges get accent styling while the rest of the graph dims
 * (independent from — and layered on top of — selection highlighting).
 */
function useHoverHighlight(nodes: Node[], edges: Edge[]) {
	const [hoveredId, setHoveredId] = useState<string>();

	return useMemo(() => {
		if (!hoveredId || !nodes.some((n) => n.id === hoveredId)) {
			return { nodes, edges, setHoveredId };
		}
		const neighbors = new Set([hoveredId]);
		for (const edge of edges) {
			if (edge.source === hoveredId) {
				neighbors.add(edge.target);
			}
			if (edge.target === hoveredId) {
				neighbors.add(edge.source);
			}
		}
		return {
			// group containers stay untouched, they are structure, not data
			nodes: nodes.map((node) =>
				node.type === "projectGroup"
					? node
					: {
							...node,
							className: appendClassName(
								node.className,
								neighbors.has(node.id)
									? "graph-node-hover-related"
									: "graph-node-hover-dimmed",
							),
						},
			),
			edges: edges.map((edge) => ({
				...edge,
				className: appendClassName(
					edge.className,
					edge.source === hoveredId || edge.target === hoveredId
						? "edge-hover-highlighted"
						: "edge-hover-dimmed",
				),
			})),
			setHoveredId,
		};
	}, [nodes, edges, hoveredId]);
}

export function FlowGraph({
	nodes,
	edges,
	nodeTypes,
	onSelect,
	onNodeContextMenu,
	focus,
	direction,
	onDirectionChange,
	refitSignal,
	toolbarExtra,
}: {
	nodes: Node[];
	edges: Edge[];
	nodeTypes: NodeTypes;
	onSelect: (nodeId: string | undefined, event?: React.MouseEvent) => void;
	onNodeContextMenu?: (event: React.MouseEvent, nodeId: string) => void;
	focus?: NodeFocusRequest;
	direction: LayoutDirection;
	onDirectionChange: (direction: LayoutDirection) => void;
	/** any change of this value re-fits the viewport to the graph */
	refitSignal?: string;
	/** extra section appended to the bottom toolbar */
	toolbarExtra?: React.ReactNode;
}) {
	// the light high contrast theme is `vscode-high-contrast vscode-high-contrast-light`,
	// so it has no `vscode-light` class to match on
	const themeClasses = document.body.classList;
	const colorMode =
		themeClasses.contains("vscode-light") ||
		themeClasses.contains("vscode-high-contrast-light")
			? "light"
			: "dark";

	const hover = useHoverHighlight(nodes, edges);

	return (
		<ReactFlow
			nodes={hover.nodes}
			edges={hover.edges}
			nodeTypes={nodeTypes}
			edgeTypes={edgeTypes}
			colorMode={colorMode}
			fitView
			minZoom={0.2}
			fitViewOptions={{ maxZoom: 1 }}
			nodesConnectable={false}
			edgesFocusable={false}
			deleteKeyCode={null}
			onNodeClick={(event, node) =>
				onSelect(node.type === "projectGroup" ? undefined : node.id, event)
			}
			onNodeContextMenu={(event, node) => {
				if (node.type !== "projectGroup") {
					onNodeContextMenu?.(event, node.id);
				}
			}}
			onNodeMouseEnter={(_event, node) => {
				if (node.type !== "projectGroup") {
					hover.setHoveredId(node.id);
				}
			}}
			onNodeMouseLeave={() => hover.setHoveredId(undefined)}
			onPaneClick={() => onSelect(undefined)}
		>
			<Background gap={16} />
			<BottomToolbar
				direction={direction}
				onDirectionChange={onDirectionChange}
				extra={toolbarExtra}
			/>
			<FitOnFocus focus={focus} />
			<FitOnChange signal={refitSignal} />
		</ReactFlow>
	);
}
