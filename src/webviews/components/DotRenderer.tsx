// @ts-ignore
import { type GraphvizOptions, graphviz } from "d3-graphviz";
import React, { useEffect, useMemo } from "react";

interface IGraphvizProps {
	dot: string;
	options?: GraphvizOptions;
	className?: string;
}

const defaultOptions: GraphvizOptions = {
	fit: true,
	height: "calc(100dvh - 30px)",
	width: "100%",
	zoom: true,
};

let counter = 0;
const getId = () => `graphviz${counter++}`;

export const Graphviz = ({ dot, className, options = {} }: IGraphvizProps) => {
	const id = useMemo(getId, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: todo
	useEffect(() => {
		graphviz(`#${id}`, {
			...defaultOptions,
			...options,
		}).renderDot(dot);
	}, [dot, options]);

	return <div className={className} id={id} />;
};
