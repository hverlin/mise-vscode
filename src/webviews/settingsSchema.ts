type FlattenedProperty = {
	key: string;
	type: string;
	description: string | undefined;
	defaultValue: unknown;
	deprecated?: string;
};

type PropertyValue = {
	type?: string;
	description?: string;
	default?: unknown;
	deprecated?: string;
	items?: { type: string };
	enum?: string[];
	properties?: Record<string, PropertyValue>;
};

type SchemaType = {
	properties: Record<string, PropertyValue>;
};

export function flattenJsonSchema(
	schema: SchemaType,
	parentKey = "",
	result: FlattenedProperty[] = [],
): FlattenedProperty[] {
	if (!schema.properties) {
		return result;
	}

	for (const [key, value] of Object.entries(schema.properties)) {
		const currentKey = parentKey ? `${parentKey}.${key}` : key;

		if (value.properties) {
			flattenJsonSchema({ properties: value.properties }, currentKey, result);
		} else {
			let propertyType = value.type;

			if (value.type === "array" && value.items) {
				propertyType = `${value.items.type}[]`;
			}

			if (value.enum) {
				propertyType = value.enum.map((v) => `"${v}"`).join(" | ");
			}

			result.push({
				key: currentKey,
				type: propertyType ?? "string",
				description: value.description,
				defaultValue: value.default,
				...(value.deprecated && { deprecated: value.deprecated }),
			});
		}
	}

	return result;
}

export function getDefaultForType(type?: string): unknown {
	switch (type) {
		case "string":
			return "";
		case "boolean":
			return false;
		case "number":
			return 0;
		case "object":
			return {};
		case "array":
			return [];
		default:
			return "";
	}
}
