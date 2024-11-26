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
