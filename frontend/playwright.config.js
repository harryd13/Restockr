import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  use: {
    baseURL,
    trace: "on-first-retry"
  }
});
