import { useQuery } from "@tanstack/react-query";
import { VscodeCheckbox } from "@vscode-elements/react-elements";
import React, { useState } from "react";
import CustomTable from "./components/CustomTable";
import { flattenJsonSchema, getDefaultForType } from "./settingsSchema";
import { toDisplayPath, vscodeClient } from "./webviewVsCodeApi";

export const Settings = () => {
	const [showModifiedOnly, setShowModifiedOnly] = useState(false);

	const settingsQuery = useQuery({
		queryKey: ["settings"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<
				Record<string, MiseSettingInfo>
			>,
	});

	const schemaQuery = useQuery({
		queryKey: ["settingsSchema"],
		queryFn: async () => {
			const res = await fetch(
				"https://raw.githubusercontent.com/jdx/mise/refs/heads/main/schema/mise.json",
			);
			if (!res.ok) {
				return [];
			}
			const json = await res.json();
			return flattenJsonSchema(json.$defs.settings);
		},
	});

	const schema = schemaQuery.data ?? [];

	if (settingsQuery.isError) {
		return <div>Error: {settingsQuery.error.message}</div>;
	}

	const settingValues = Object.entries(settingsQuery.data ?? {})
		.flatMap(([key, { value, source }]) => {
			if (typeof value === "object" && !Array.isArray(value)) {
				return Object.entries(value).map(([subKey, subValue]) => ({
					key: `${key}.${subKey}`,
					value: subValue,
					source,
				}));
			}
			return { key, value, source };
		})
		.map(({ key, value, source }) => {
			const schemaDef = schema.find((schema) => schema.key === key);
			return {
				key,
				value,
				source,
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
			<CustomTable
				style={{ height: window.innerHeight - 40 }}
				filterRowElement={
					<VscodeCheckbox
						onChange={() => setShowModifiedOnly(!showModifiedOnly)}
						label="Show modified only"
						checked={showModifiedOnly ? true : undefined}
					/>
				}
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
						cell: ({ row }) => {
							return (
								<div>
									<p style={{ marginBottom: 0 }}>
										<b>{row.original.key}</b>
									</p>
									<p style={{ opacity: 0.8, marginTop: 8 }}>
										{row.original.description} ({row.original.type})
									</p>
								</div>
							);
						},
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
									{row.original.source && (
										<>
											<br />
											source: {toDisplayPath(row.original.source || "")}
										</>
									)}
								</pre>
							);
						},
					},
				]}
			/>
		</div>
	);
};
