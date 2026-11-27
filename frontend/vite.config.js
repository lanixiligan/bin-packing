import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server forwards /api to the FastAPI backend (default port 8000).
// Override with VITE_API_TARGET=http://localhost:8010 and --port for a second stack.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    proxy: {
      "/api": process.env.VITE_API_TARGET || "http://localhost:8000",
    },
  },
  // One page: the load planner (index.html).
  build: {
    rollupOptions: {
      input: { main: "index.html" },
    },
  },
  // Component tests for the load planner (src/planner). The DG rules port runs with `node --test`.
  test: {
    environment: "jsdom",
    include: ["src/planner/**/*.test.{ts,tsx}"],
    setupFiles: ["src/planner/test/setup.ts"],
    css: false,
    testTimeout: 15000, // userEvent-heavy tests can pass 5 s on a busy machine
  },
});
