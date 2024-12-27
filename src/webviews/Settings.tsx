import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VscodeCheckbox } from "@vscode-elements/react-elements";
import React, { useState } from "react";
import { type FlattenedProperty, getDefaultForType } from "../utils/miseUtilts";
import CustomTable from "./components/CustomTable";
import { IconButton } from "./components/IconButton";
import {
	toDisplayPath,
	useEditSettingMutation,
	useOpenFileMutation,
	vscodeClient,
} from "./webviewVsCodeApi";

export const Settings = () => {
	const [showModifiedOnly, setShowModifiedOnly] = useState(true);
	const openFileMutation = useOpenFileMutation();
	const queryClient = useQueryClient();

	const settingsQuery = useQuery({
		queryKey: ["settings"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<
				Record<string, MiseSettingInfo>
			>,
	});

	const settingMutation = useEditSettingMutation();

	const schemaQuery = useQuery({
		queryKey: ["settingsSchema"],
		queryFn: ({ queryKey }) =>
			vscodeClient.request({ queryKey }) as Promise<FlattenedProperty[]>,
	});

	if (schemaQuery.isPending || settingsQuery.isPending) {
		return <div />;
	}

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
				enum: schemaDef?.enum ?? [],
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
					(value) => !showModifiedOnly || value.source,
				)}
				columns={[
					{
						id: "key",
						header: "Key",
						accessorKey: "key",
						cell: ({ row }) => {
							const key = row.original.key;
							return (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 6,
										padding: "8px 0px",
									}}
								>
									<div>
										<a
											href={`https://mise.jdx.dev/configuration/settings.html#${key}`}
										>
											{key}
										</a>
									</div>
									<div style={{ opacity: 0.8 }}>
										{row.original.description}{" "}
										{row.original.enum?.length > 0 ? (
											<span>
												<br />
												Enum: {row.original.enum.join(", ")}
											</span>
										) : row.original.type ? (
											`(${row.original.type})`
										) : (
											""
										)}
									</div>
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
							const source = row.original.source;

							return (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 2,
										padding: "8px 0px",
									}}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											flexWrap: "wrap",
											gap: 8,
										}}
									>
										<pre style={{ padding: 0, margin: 0 }}>{actual}</pre>{" "}
										<IconButton
											style={{ margin: 0, padding: 0 }}
											iconName="edit"
											onClick={() => {
												void settingMutation.mutate(
													{ key: row.original.key },
													{ onSettled: () => queryClient.invalidateQueries() },
												);
											}}
										/>
									</div>
									{actual !== defaultValue && (
										<div
											style={{ display: "flex", alignItems: "center", gap: 4 }}
										>
											default:{" "}
											<pre style={{ padding: 0, margin: 0 }}>
												{defaultValue}
											</pre>
										</div>
									)}
									{source && (
										<div
											style={{ display: "flex", alignItems: "center", gap: 4 }}
										>
											source{" "}
											<a
												href={`file://${source}`}
												onClick={(e) => {
													e.preventDefault();
													openFileMutation.mutate(source);
												}}
											>
												{toDisplayPath(source || "")}
											</a>
										</div>
									)}
								</div>
							);
						},
					},
				]}
			/>
		</div>
	);
};
