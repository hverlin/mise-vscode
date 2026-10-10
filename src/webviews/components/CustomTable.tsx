import { type RankingInfo, rankItem } from "@tanstack/match-sorter-utils";
import {
	type ColumnDef,
	columnFilteringFeature,
	createFilteredRowModel,
	createSortedRowModel,
	type FilterFn,
	flexRender,
	globalFilteringFeature,
	metaHelper,
	type RowData,
	rowSortingFeature,
	type SortingState,
	sortFn_alphanumeric,
	sortFn_datetime,
	sortFn_text,
	type TableFeatures,
	tableFeatures,
	useTable,
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

type FuzzyFilterMeta = {
	itemRank?: RankingInfo;
};

const fuzzyFilter: FilterFn<
	TableFeatures & { filterMeta: FuzzyFilterMeta },
	RowData
> = (row, columnId, value, addMeta) => {
	const itemRank = rankItem(row.getValue(columnId), value);
	addMeta?.({ itemRank });
	return itemRank.passed;
};

const features = tableFeatures({
	columnFilteringFeature,
	globalFilteringFeature,
	rowSortingFeature,
	filteredRowModel: createFilteredRowModel(),
	sortedRowModel: createSortedRowModel(),
	filterFns: { fuzzy: fuzzyFilter },
	filterMeta: metaHelper<FuzzyFilterMeta>(),
	// the functions the "auto" sort picks from, which only resolves registered ones
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		datetime: sortFn_datetime,
		text: sortFn_text,
	},
});

export type CustomTableColumn<T extends RowData> = ColumnDef<
	typeof features,
	T
>;

type VSCodeTableProps<T extends RowData> = {
	data: T[];
	columns: CustomTableColumn<T>[];
	isLoading?: boolean;
	filterRowElement?: ReactElement | string;
	/** rows for which this returns true get the selected-row background */
	isRowSelected?: (rowData: T) => boolean;
};

export default function CustomTable<T extends RowData>({
	data,
	columns,
	isLoading = false,
	filterRowElement,
	isRowSelected,
	style,
}: VSCodeTableProps<T> & { style?: CSSProperties }) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState<string | number>("");

	const table = useTable({
		features,
		data,
		columns,
		state: { sorting, globalFilter },
		onGlobalFilterChange: setGlobalFilter,
		onSortingChange: setSorting,
		globalFilterFn: "fuzzy",
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
						<VscodeTableRow
							key={row.id}
							className={`vscode-table__row${
								isRowSelected?.(row.original)
									? " vscode-table__row--selected"
									: ""
							}`}
						>
							{row.getAllCells().map((cell) => (
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
