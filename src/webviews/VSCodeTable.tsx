import {
	type ColumnDef,
	type SortingState,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";

import { useState } from "react";

type VSCodeTableProps<T> = {
	data: T[];
	columns: ColumnDef<T>[];
	isLoading?: boolean;
};

export default function VSCodeTable<T>({
	data,
	columns,
	isLoading = false,
}: VSCodeTableProps<T>) {
	const [sorting, setSorting] = useState<SortingState>([]);

	const table = useReactTable({
		data,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});

	if (isLoading) {
		return (
			<div className="vscode-table">
				<div className="vscode-table__loading">Loading...</div>
			</div>
		);
	}

	if (!data.length) {
		return (
			<div className="vscode-table">
				<div className="vscode-table__empty">No data available</div>
			</div>
		);
	}

	return (
		<div className="vscode-table" style={{ position: "relative" }}>
			<table>
				<thead>
					{table.getHeaderGroups().map((headerGroup) => (
						<tr key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<th key={header.id}>
									{header.isPlaceholder ? null : (
										<button
											type="button"
											className="vscode-table__sort-button"
											onClick={header.column.getToggleSortingHandler()}
										>
											{flexRender(
												header.column.columnDef.header,
												header.getContext(),
											)}
											<span className="vscode-table__sort-icon">
												{header.column.getIsSorted() === false
													? ""
													: header.column.getIsSorted() === "asc"
														? "↑"
														: "↓"}
											</span>
										</button>
									)}
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody
					style={{
						maxHeight: "calc(100dvh - 80px)",
						overflowY: "auto",
					}}
				>
					{table.getRowModel().rows.map((row) => (
						<tr key={row.id}>
							{row.getVisibleCells().map((cell) => (
								<td key={cell.id}>
									{flexRender(cell.column.columnDef.cell, cell.getContext())}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
