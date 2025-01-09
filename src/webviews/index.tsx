import React from "react";
import ReactDOM from "react-dom/client";
import "./webview.css";
import "@vscode/codicons/dist/codicon.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { App } from "./App";

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: 1 } },
});

window.addEventListener("message", (event) => {
	if (event.data.type === "invalidateQueries") {
		void queryClient.invalidateQueries();
	}
});

// @ts-ignore
function Fallback({ error, resetErrorBoundary }) {
	return (
		<div role="alert">
			<p>Something went wrong:</p>
			<pre style={{ color: "red" }}>{error.stack}</pre>

			<button type="button" onClick={resetErrorBoundary}>
				Try again
			</button>
		</div>
	);
}

// @ts-expect-error
ReactDOM.createRoot(document.getElementById("root")).render(
	<React.StrictMode>
		<ErrorBoundary FallbackComponent={Fallback}>
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</ErrorBoundary>
	</React.StrictMode>,
);
