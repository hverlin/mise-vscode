import {
	type ColumnDef,
	type SortingState,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";

import {
	VscodeTable,
	VscodeTableBody,
	VscodeTableCell,
	VscodeTableHeader,
	VscodeTableHeaderCell,
	VscodeTableRow,
} from "@vscode-elements/react-elements";
import { useState } from "react";

type VSCodeTableProps<T> = {
	data: T[];
	columns: ColumnDef<T>[];
	isLoading?: boolean;
};

export default function CustomTable<T>({
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
		<VscodeTable
			resizable
			bordered-columns
			// @ts-ignore
			zebra
			style={{ maxHeight: "100dvh" }}
		>
			{table.getHeaderGroups().map((headerGroup) => (
				<VscodeTableHeader slot="header" key={headerGroup.id}>
					{headerGroup.headers.map((header) => (
						<VscodeTableHeaderCell key={header.id}>
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
						</VscodeTableHeaderCell>
					))}
				</VscodeTableHeader>
			))}
			<VscodeTableBody slot="body">
				{table.getRowModel().rows.map((row) => (
					<VscodeTableRow key={row.id} className="vscode-table__row">
						{row.getVisibleCells().map((cell) => (
							<VscodeTableCell
								key={cell.id}
								style={{
									whiteSpace: "wrap",
								}}
							>
								{flexRender(cell.column.columnDef.cell, cell.getContext())}
							</VscodeTableCell>
						))}
					</VscodeTableRow>
				))}
			</VscodeTableBody>
		</VscodeTable>
	);
}
