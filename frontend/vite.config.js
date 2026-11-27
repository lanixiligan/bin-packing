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
  // Component tests for the demo page (src/demo). The DG rules port and the demo's pure helpers
  // run with `node --test`.
  test: {
    environment: "jsdom",
    include: ["src/demo/**/*.test.{jsx,tsx}"],
    setupFiles: ["src/shared/test/setup.ts"],
    css: false,
    testTimeout: 15000, // userEvent-heavy tests can pass 5 s on a busy machine
  },
});
