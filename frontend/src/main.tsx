import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { MOCK_API } from "./api/client";
import { ApiError } from "./api/errors";
import { AuthProvider } from "./auth/AuthContext";
import { router } from "./router";
import "./App.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // Don't retry client errors (403, 404, 422…); retry others once.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
    },
  },
});

function render() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

// The mock API (VITE_MOCK_API=1) registers its handlers before the first request.
(MOCK_API ? import("./api/mocks").then(() => undefined) : Promise.resolve()).then(render);
