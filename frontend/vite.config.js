import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server forwards /solve to the FastAPI backend on port 8000,
// so the frontend can just call fetch("/solve").
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/solve": "http://localhost:8000",
    },
  },
});
