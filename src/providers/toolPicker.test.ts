import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import type { ToolSearchResult } from "../utils/toolSearch";
import { CUSTOM_TOOL, pickToolToUse } from "./toolPicker";

type Item = vscode.QuickPickItem & { searchPrefix?: string };

/** a QuickPick driven by the test, as if the user typed and picked */
function createFakeQuickPick() {
	const listeners = {
		value: [] as ((value: string) => void)[],
		accept: [] as (() => void)[],
		hide: [] as (() => void)[],
	};
	const listen =
		<T>(list: T[]) =>
		(listener: T) => {
			list.push(listener);
			return { dispose: () => {} };
		};
	let value = "";
	const quickPick = {
		items: [] as Item[],
		selectedItems: [] as Item[],
		busy: false,
		placeholder: "",
		matchOnDescription: false,
		get value() {
			return value;
		},
		set value(newValue: string) {
			value = newValue;
			for (const listener of listeners.value) {
				listener(newValue);
			}
		},
		onDidChangeValue: listen(listeners.value),
		onDidAccept: listen(listeners.accept),
		onDidHide: listen(listeners.hide),
		show: () => {},
		hide: () => {
			for (const listener of listeners.hide) {
				listener();
			}
		},
		dispose: () => {},
	};
	return {
		quickPick,
		type: (text: string) => {
			quickPick.value = text;
		},
		accept: (label: string) => {
			const item = quickPick.items.find((i) => i.label === label);
			if (!item) {
				throw new Error(`No item ${label}`);
			}
			quickPick.selectedItems = [item];
			for (const listener of listeners.accept) {
				listener();
			}
		},
	};
}

const window = vscode.window as unknown as Record<string, unknown>;
const originalCreateQuickPick = window.createQuickPick;

function setUp({
	canSearchPackages = true,
	searchTools = async (_query: string): Promise<ToolSearchResult[]> => [],
} = {}) {
	const fake = createFakeQuickPick();
	window.createQuickPick = () => fake.quickPick;
	const queries: string[] = [];
	const miseService = {
		miseRegistry: async () => [
			{ short: "node", full: "core:node", backends: ["core:node"] },
		],
		supportsPackageRegistrySearch: async () => canSearchPackages,
		searchTools: (query: string) => {
			queries.push(query);
			return searchTools(query);
		},
	} as unknown as MiseService;
	return { fake, queries, picked: pickToolToUse(miseService) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const afterSearchDelay = () =>
	new Promise((resolve) => setTimeout(resolve, 350));
const labels = (items: Item[]) => items.map((item) => item.label);

afterEach(() => {
	window.createQuickPick = originalCreateQuickPick;
});

describe("pickToolToUse", () => {
	it("offers the registry tools and the package registries", async () => {
		const { fake } = setUp();
		await settle();
		expect(labels(fake.quickPick.items)).toEqual([
			CUSTOM_TOOL,
			"npm:",
			"cargo:",
			"gem:",
			"dotnet:",
			"node",
		]);
	});

	it("only offers the registry tools when mise cannot search packages", async () => {
		const { fake, queries } = setUp({ canSearchPackages: false });
		await settle();
		expect(labels(fake.quickPick.items)).toEqual([CUSTOM_TOOL, "node"]);

		fake.type("npm:prettier");
		await afterSearchDelay();
		expect(queries).toEqual([]);
	});

	it("searches the package registry typed, once the user stops typing", async () => {
		const { fake, queries, picked } = setUp({
			searchTools: async (query) => [
				{ name: query, description: "the package" },
				{ name: `${query}-plugin`, description: "" },
			],
		});
		await settle();

		fake.type("npm:p");
		fake.type("npm:prettier");
		expect(fake.quickPick.busy).toBe(true);
		await afterSearchDelay();

		expect(queries).toEqual(["npm:prettier"]);
		expect(fake.quickPick.busy).toBe(false);
		expect(labels(fake.quickPick.items)).toEqual([
			"npm:prettier",
			"npm:prettier-plugin",
		]);
		expect(fake.quickPick.items.every((item) => item.alwaysShow)).toBe(true);

		fake.accept("npm:prettier-plugin");
		expect(await picked).toBe("npm:prettier-plugin");
	});

	it("fills in the prefix of a package registry picked", async () => {
		const { fake } = setUp();
		await settle();

		fake.accept("cargo:");
		expect(fake.quickPick.value).toBe("cargo:");
		expect(labels(fake.quickPick.items)).toContain("node");
	});

	it("drops the results of a search the user typed past", async () => {
		let finishSearch: (results: ToolSearchResult[]) => void = () => {};
		const { fake } = setUp({
			searchTools: () =>
				new Promise((resolve) => {
					finishSearch = resolve;
				}),
		});
		await settle();

		fake.type("npm:prettier");
		await afterSearchDelay();
		fake.type("node");
		finishSearch([{ name: "npm:prettier", description: "" }]);
		await settle();

		expect(fake.quickPick.busy).toBe(false);
		expect(labels(fake.quickPick.items)).toContain("node");
		expect(labels(fake.quickPick.items)).not.toContain("npm:prettier");
	});

	it("shows no results when the search fails", async () => {
		const logged = spyOn(logger, "info").mockImplementation(() => {});
		const { fake } = setUp({
			searchTools: async () => {
				throw new Error("network");
			},
		});
		await settle();

		fake.type("gem:rails");
		await afterSearchDelay();
		expect(fake.quickPick.items).toEqual([]);
		expect(fake.quickPick.busy).toBe(false);
		expect(logged).toHaveBeenCalled();
		logged.mockRestore();
	});

	it("resolves with the registry tool, or nothing when dismissed", async () => {
		const first = setUp();
		await settle();
		first.fake.accept("node");
		expect(await first.picked).toBe("node");

		const second = setUp();
		await settle();
		second.fake.quickPick.hide();
		expect(await second.picked).toBeUndefined();
	});
});
