import { create } from "zustand/index";
import { type StorageValue, persist } from "zustand/middleware";
import { vscode } from "./webviewVsCodeApi";

interface WebviewStore {
	showModifiedSettingsOnly: boolean;
	setShowModifiedSettingsOnly: (value: boolean) => void;

	selectedTool: MiseTool | null;
	setSelectedTool: (value: MiseTool | null) => void;

	showOutdatedOnly: boolean;
	setShowOutdatedOnly: (value: boolean) => void;

	showActiveToolsOnly: boolean;
	setShowActiveToolsOnly: (value: boolean) => void;
}

export const useWebviewStore = create<WebviewStore>()(
	persist(
		(set) => ({
			showModifiedSettingsOnly: true,
			setShowModifiedSettingsOnly: (value: boolean) =>
				set({ showModifiedSettingsOnly: value }),

			selectedTool: null,
			setSelectedTool: (value: MiseTool | null) => set({ selectedTool: value }),

			showOutdatedOnly: false,
			setShowOutdatedOnly: (value: boolean) => set({ showOutdatedOnly: value }),

			showActiveToolsOnly: true,
			setShowActiveToolsOnly: (value: boolean) =>
				set({ showActiveToolsOnly: value }),
		}),
		{
			name: "webview-store",
			storage: {
				getItem: async (name) => {
					const state = await vscode.getState();
					return state[name] as StorageValue<WebviewStore>;
				},
				setItem: async (name, value) => {
					return vscode.setState({ [name]: value });
				},
				removeItem: async (name) => {
					const state = await vscode.getState();
					delete state[name];
					vscode.setState(state);
				},
			},
		},
	),
);
