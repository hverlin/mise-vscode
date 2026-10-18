import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import type { ToolSearchResult } from "../utils/toolSearch";
import { pickToolToUse } from "./toolPicker";

type Item = vscode.QuickPickItem & { tool?: string; searchPrefix?: string };

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
	let items: Item[] = [];
	const quickPick = {
		/** how many times the items were sent to the window */
		itemSets: 0,
		get items() {
			return items;
		},
		// copied, as VS Code does
		set items(newItems: Item[]) {
			items = [...newItems];
			quickPick.itemSets++;
		},
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
			const item = quickPick.items.find(
				(i) => i.label === label || i.tool === label,
			);
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
			{ short: "prettier", full: "npm:prettier", backends: ["npm:prettier"] },
			{
				short: "jq",
				full: "aqua:jqlang/jq",
				backends: ["aqua:jqlang/jq", "github:jqlang/jq"],
			},
		],
		miseRegistryDescriptions: async () =>
			new Map([["jq", "Command-line JSON processor"]]),
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
	it("offers the package registries and the registry tools", async () => {
		const { fake } = setUp();
		await settle();
		expect(labels(fake.quickPick.items)).toEqual([
			"npm:",
			"cargo:",
			"gem:",
			"dotnet:",
			"node",
			"prettier",
			"jq",
		]);
	});

	it("describes the registry tools after their backend", async () => {
		const { fake } = setUp();
		await settle();
		const describe = (label: string) =>
			fake.quickPick.items.find((item) => item.label === label)?.description;
		expect(describe("jq")).toBe("aqua:jqlang/jq · Command-line JSON processor");
		expect(describe("node")).toBe("core:node");

		fake.type("github:jqlang");
		expect(describe("jq")).toBe(
			"github:jqlang/jq · Command-line JSON processor",
		);
	});

	it("only offers the registry tools when mise cannot search packages", async () => {
		const { fake, queries } = setUp({ canSearchPackages: false });
		await settle();
		expect(labels(fake.quickPick.items)).toEqual(["node", "prettier", "jq"]);

		fake.type("npm:pr");
		await afterSearchDelay();
		expect(queries).toEqual([]);
		expect(labels(fake.quickPick.items)).toEqual([
			"prettier",
			"$(edit) Use as typed",
		]);
	});

	it("lists the registry tools of a package registry first, then its packages", async () => {
		const { fake, queries, picked } = setUp({
			searchTools: async () => [
				{ name: "npm:pr", description: "node builtins" },
				{ name: "npm:prettier", description: "the formatter" },
				{ name: "npm:pr-shepherd", description: "" },
			],
		});
		await settle();

		fake.type("npm:p");
		fake.type("npm:pr");
		// the registry tools, at once
		expect(labels(fake.quickPick.items)).toEqual([
			"prettier",
			"$(edit) Use as typed",
		]);
		expect(fake.quickPick.busy).toBe(true);
		await afterSearchDelay();

		expect(queries).toEqual(["npm:pr"]);
		expect(fake.quickPick.busy).toBe(false);
		// npm:prettier is the registry tool, and npm:pr was typed
		expect(labels(fake.quickPick.items)).toEqual([
			"prettier",
			"$(package) pr",
			"$(package) pr-shepherd",
		]);
		expect(fake.quickPick.items.every((item) => item.alwaysShow)).toBe(true);
		// no label holds what was typed, so the window keeps this order
		expect(
			fake.quickPick.items.some((item) => item.label.includes("npm:pr")),
		).toBe(false);

		fake.accept("npm:pr-shepherd");
		expect(await picked).toBe("npm:pr-shepherd");
	});

	it("picks a registry tool by its name", async () => {
		const { fake, picked } = setUp();
		await settle();
		fake.type("npm:prett");
		fake.accept("prettier");
		expect(await picked).toBe("prettier");
	});

	it("uses a backend:name as typed, also with its version", async () => {
		const github = setUp();
		await settle();
		github.fake.type("github:jqlang/jq");
		expect(labels(github.fake.quickPick.items)).toEqual(["jq"]);
		github.fake.type("github:cli/cli");
		expect(github.fake.quickPick.items).toEqual([
			{
				label: "$(edit) Use as typed",
				description: "github:cli/cli",
				tool: "github:cli/cli",
				alwaysShow: true,
			},
		]);
		github.fake.accept("github:cli/cli");
		expect(await github.picked).toBe("github:cli/cli");

		const versioned = setUp();
		await settle();
		versioned.fake.type("node@20");
		versioned.fake.accept("node@20");
		expect(await versioned.picked).toBe("node@20");
	});

	it("searches the packages without the version typed", async () => {
		const { fake, queries } = setUp({
			searchTools: async (query) => [{ name: query, description: "" }],
		});
		await settle();

		fake.type("npm:left-pad@1");
		await afterSearchDelay();
		expect(queries).toEqual(["npm:left-pad"]);
		expect(labels(fake.quickPick.items)).toEqual([
			"$(package) left-pad",
			"$(edit) Use as typed",
		]);
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

		fake.type("npm:left-pad");
		await afterSearchDelay();
		fake.type("node");
		finishSearch([{ name: "npm:left-pad", description: "" }]);
		await settle();

		expect(fake.quickPick.busy).toBe(false);
		expect(labels(fake.quickPick.items)).toContain("node");
		expect(labels(fake.quickPick.items)).not.toContain("$(package) left-pad");
	});

	it("still offers the name typed when the search fails", async () => {
		const logged = spyOn(logger, "info").mockImplementation(() => {});
		const { fake } = setUp({
			searchTools: async () => {
				throw new Error("network");
			},
		});
		await settle();

		fake.type("gem:rails");
		await afterSearchDelay();
		expect(labels(fake.quickPick.items)).toEqual(["$(edit) Use as typed"]);
		expect(fake.quickPick.busy).toBe(false);
		expect(logged).toHaveBeenCalled();
		logged.mockRestore();
	});

	it("only sends the registry again after typing a backend", async () => {
		const { fake } = setUp();
		await settle();
		const initialSets = fake.quickPick.itemSets;

		fake.type("n");
		fake.type("no");
		fake.type("node");
		expect(fake.quickPick.itemSets).toBe(initialSets);

		fake.type("github:cli/cli");
		fake.type("node");
		fake.type("nod");
		expect(fake.quickPick.itemSets).toBe(initialSets + 2);
		expect(labels(fake.quickPick.items)).toContain("node");
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
