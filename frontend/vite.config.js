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
  // Two pages: the load planner (index.html) and the bin-packing demo (demo.html).
  build: {
    rollupOptions: {
      input: { main: "index.html", demo: "demo.html" },
    },
  },
  // Component tests for the load planner (src/planner) and the demo page (src/demo). The DG rules
  // port and the demo's pure helpers run with `node --test`.
  test: {
    environment: "jsdom",
    include: ["src/planner/**/*.test.{ts,tsx}", "src/demo/**/*.test.{jsx,tsx}"],
    setupFiles: ["src/planner/test/setup.ts"],
    css: false,
  },
});
