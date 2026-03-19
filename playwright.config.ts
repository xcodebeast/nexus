import { defineConfig, devices } from "@playwright/test";

const E2E_PASSWORD = "nexus";
const E2E_PORT = "3100";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    permissions: ["microphone"],
    trace: "on-first-retry",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  webServer: {
    command: "bun src/index.ts",
    env: {
      ...process.env,
      PORT: E2E_PORT,
      NEXUS_PASSWORD: E2E_PASSWORD,
      NEXUS_PASSWORD_HASH: "",
    },
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
