import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import VSCodeTable from "./VSCodeTable";
import { flattenedSettingsSchema, getDefaultForType } from "./settingsSchema";
import { vscodeClient } from "./webviewVsCodeApi";

export const Settings = () => {
	const [showModifiedOnly, setShowModifiedOnly] = useState(false);

	const settingsQuery = useQuery({
		queryKey: ["settings"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<object>,
	});

	if (settingsQuery.isError) {
		return <div>Error: {settingsQuery.error.message}</div>;
	}

	const settingValues = Object.entries(settingsQuery.data ?? {})
		.flatMap(([key, value]) => {
			if (typeof value === "object" && !Array.isArray(value)) {
				return Object.entries(value).map(([subKey, subValue]) => ({
					key: `${key}.${subKey}`,
					value: subValue,
				}));
			}
			return { key, value };
		})
		.map(({ key, value }) => {
			const schemaDef = flattenedSettingsSchema.find(
				(schema) => schema.key === key,
			);
			return {
				key,
				value,
				description: schemaDef?.description ?? "",
				type: schemaDef?.type ?? "",
				defaultValue: schemaDef?.defaultValue
					? schemaDef.defaultValue
					: getDefaultForType(schemaDef?.type),
				deprecated: schemaDef?.deprecated ?? "",
			};
		});

	return (
		<div>
			<div style={{ padding: "10px" }}>
				<input
					id={"showModifiedOnly"}
					name={"showModifiedOnly"}
					type={"checkbox"}
					checked={showModifiedOnly}
					onChange={(e) => setShowModifiedOnly(e.target.checked)}
				/>
				<label htmlFor={"showModifiedOnly"}>Show modified only</label>
			</div>
			<VSCodeTable
				isLoading={settingsQuery.isLoading}
				data={settingValues.filter(
					(value) =>
						!showModifiedOnly ||
						JSON.stringify(value.value) !== JSON.stringify(value.defaultValue),
				)}
				columns={[
					{
						id: "key",
						header: "Key",
						accessorKey: "key",
					},
					{
						id: "value",
						header: "Value",
						accessorKey: "value",
						cell: ({ row }) => {
							const actual = JSON.stringify(row.original.value);
							const defaultValue = JSON.stringify(row.original.defaultValue);
							if (actual === defaultValue) {
								return <pre>{actual}</pre>;
							}

							return (
								<pre>
									value: <b>{actual}</b>
									<br />
									default: {defaultValue}
								</pre>
							);
						},
					},
					{
						id: "description",
						header: "Description",
						accessorKey: "description",
						cell: ({ row }) => {
							return (
								<div>
									{row.original.description} (type: {row.original.type})
								</div>
							);
						},
					},
				]}
			/>
		</div>
	);
};
