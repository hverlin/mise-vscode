import { rankItem } from "@tanstack/match-sorter-utils";
import {
	type ColumnDef,
	type FilterFn,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type SortingState,
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
import { type CSSProperties, type ReactElement, useState } from "react";
import { DebouncedInput } from "./DebouncedInput";

type VSCodeTableProps<T> = {
	data: T[];
	columns: ColumnDef<T>[];
	isLoading?: boolean;
	filterRowElement?: ReactElement | string;
};

export default function CustomTable<T>({
	data,
	columns,
	isLoading = false,
	filterRowElement,
	style,
}: VSCodeTableProps<T> & { style?: CSSProperties }) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState<string | number>("");

	const fuzzyFilter: FilterFn<T> = (row, columnId, value, addMeta) => {
		const itemRank = rankItem(row.getValue(columnId), value);
		addMeta({ itemRank });
		return itemRank.passed;
	};

	const table = useReactTable({
		data,
		columns,
		state: { sorting, globalFilter },
		onGlobalFilterChange: setGlobalFilter,
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		globalFilterFn: fuzzyFilter,
	});

	if (isLoading) {
		return (
			<div className="vscode-table">
				<div className="vscode-table__loading">Loading...</div>
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				gap: "4px",
			}}
		>
			<div
				style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 2 }}
			>
				<DebouncedInput
					autoFocus={true}
					value={globalFilter}
					onChange={(value) => {
						setGlobalFilter(value);
					}}
					placeholder="Search"
				/>
				{filterRowElement}
			</div>
			<VscodeTable
				resizable
				bordered-columns
				// @ts-ignore
				zebra
				responsive
				breakpoint={500}
				style={style}
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
					{table.getRowModel().rows.length === 0 && (
						<VscodeTableRow>
							<center style={{ padding: 50 }}>No data found</center>
						</VscodeTableRow>
					)}
					{table.getRowModel().rows.map((row) => (
						<VscodeTableRow key={row.id} className="vscode-table__row">
							{row.getVisibleCells().map((cell) => (
								<VscodeTableCell key={cell.id} style={{ whiteSpace: "wrap" }}>
									{flexRender(cell.column.columnDef.cell, cell.getContext())}
								</VscodeTableCell>
							))}
						</VscodeTableRow>
					))}
				</VscodeTableBody>
			</VscodeTable>
		</div>
	);
}
