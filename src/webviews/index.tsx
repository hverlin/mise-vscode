import React from "react";
import ReactDOM from "react-dom/client";
import { Tools } from "./Tools";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const queryClient = new QueryClient();

// @ts-expect-error
ReactDOM.createRoot(document.getElementById("root")).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<Tools />
		</QueryClientProvider>
	</React.StrictMode>,
);
