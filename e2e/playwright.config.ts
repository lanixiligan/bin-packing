// End-to-end walkthrough against a running stack (see README "End-to-end test").
//   E2E_API_URL  backend, default http://localhost:8000
//   E2E_WEB_URL  web app, default http://localhost:5173
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
  },
});
