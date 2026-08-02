import dagre from "@dagrejs/dagre";
import {
	Background,
	ControlButton,
	Controls,
	type Edge,
	type Node,
	type NodeTypes,
	Position,
	ReactFlow,
	useReactFlow,
	useStore,
} from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
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

const nodeSize = (node: Node) => ({
	width: (node.width as number | undefined) ?? NODE_WIDTH,
	height: (node.height as number | undefined) ?? NODE_HEIGHT,
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
): NodeType[] {
	const connectedIds = new Set(edges.flatMap((e) => [e.source, e.target]));
	const connected = nodes.filter((n) => connectedIds.has(n.id));
	const isolated = nodes.filter((n) => !connectedIds.has(n.id));

	const graph = new dagre.graphlib.Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({ rankdir: direction, nodesep: 30, ranksep: 60 });
	for (const node of connected) {
		graph.setNode(node.id, nodeSize(node));
	}
	for (const edge of edges) {
		if (connectedIds.has(edge.source) && connectedIds.has(edge.target)) {
			graph.setEdge(edge.source, edge.target);
		}
	}
	dagre.layout(graph);

	const positionedConnected = connected.map((node) => {
		const { x, y } = graph.node(node.id);
		const { width, height } = nodeSize(node);
		return {
			...node,
			...handlePositions(direction),
			position: { x: x - width / 2, y: y - height / 2 },
		};
	});

	let gridStartY = 0;
	for (const node of positionedConnected) {
		gridStartY = Math.max(
			gridStartY,
			node.position.y + nodeSize(node).height + 80,
		);
	}

	// simple row-based packing (isolated nodes may have different sizes)
	const columns = Math.max(2, Math.ceil(Math.sqrt(isolated.length)));
	let cursorX = 0;
	let cursorY = gridStartY;
	let rowHeight = 0;
	const positionedIsolated = isolated.map((node, index) => {
		const { width, height } = nodeSize(node);
		if (index > 0 && index % columns === 0) {
			cursorX = 0;
			cursorY += rowHeight + GRID_GAP_Y;
			rowHeight = 0;
		}
		const position = { x: cursorX, y: cursorY };
		cursorX += width + GRID_GAP_X;
		rowHeight = Math.max(rowHeight, height);
		return { ...node, ...handlePositions(direction), position };
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
		const laidOut = layoutGraph(group.members, innerEdges, direction);

		let maxX = 0;
		let maxY = 0;
		for (const node of laidOut) {
			const { width, height } = nodeSize(node);
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
}) {
	const colorMode = document.body.classList.contains("vscode-light")
		? "light"
		: "dark";

	return (
		<ReactFlow
			nodes={nodes}
			edges={edges}
			nodeTypes={nodeTypes}
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
			onPaneClick={() => onSelect(undefined)}
		>
			<Background gap={16} />
			<Controls showInteractive={false}>
				<ControlButton
					title="Vertical layout"
					className={direction === "TB" ? "control-button-active" : ""}
					onClick={() => onDirectionChange("TB")}
				>
					<i className="codicon codicon-arrow-down" />
				</ControlButton>
				<ControlButton
					title="Horizontal layout"
					className={direction === "LR" ? "control-button-active" : ""}
					onClick={() => onDirectionChange("LR")}
				>
					<i className="codicon codicon-arrow-right" />
				</ControlButton>
			</Controls>
			<FitOnFocus focus={focus} />
			<FitOnChange signal={refitSignal} />
		</ReactFlow>
	);
}
