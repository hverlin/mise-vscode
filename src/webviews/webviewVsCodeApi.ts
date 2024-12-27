import { queryOptions, useMutation } from "@tanstack/react-query";

declare global {
	interface Window {
		acquireVsCodeApi(): {
			postMessage(message: unknown): void;
		};
	}
}

export function getVsCode() {
	return window.acquireVsCodeApi();
}

export const vscode = getVsCode();

export const vscodeClient = {
	async request({
		queryKey,
		mutationKey,
		variables,
	}: {
		queryKey?: string[];
		mutationKey?: string[];
		variables?: Record<string, unknown>;
	}) {
		return new Promise((resolve, reject) => {
			const requestId = crypto.randomUUID();

			const messageHandler = (event: MessageEvent) => {
				const message = event.data;
				if (message.type === "response" && message.requestId === requestId) {
					window.removeEventListener("message", messageHandler);
					if (message.error) {
						return reject(message.error);
					}
					resolve(message.data);
				}
			};

			window.addEventListener("message", messageHandler);

			vscode.postMessage({
				type: queryKey ? "query" : "mutation",
				queryKey,
				mutationKey,
				variables,
				requestId,
			});
		});
	},
};

const homeDir = document
	.querySelector("meta[name='homeDir']")
	?.getAttribute("content");

export const toDisplayPath = (path: string) => {
	if (!homeDir) {
		return path;
	}
	return path?.replace(homeDir, "~");
};

export const trackedConfigsQueryOptions = queryOptions({
	queryKey: ["trackedConfigs"],
	queryFn: ({ queryKey }) =>
		vscodeClient.request({ queryKey }) as Promise<
			Array<{ path: string; tools: object }>
		>,
});

export const useOpenFileMutation = () =>
	useMutation({
		mutationKey: ["openFile"],
		mutationFn: (path: string) =>
			vscodeClient.request({ mutationKey: ["openFile"], variables: { path } }),
	});

export const useEditSettingMutation = () =>
	useMutation({
		mutationKey: ["editSetting"],
		mutationFn: ({ key }: { key: string }) =>
			vscodeClient.request({
				mutationKey: ["editSetting"],
				variables: { key },
			}),
	});
