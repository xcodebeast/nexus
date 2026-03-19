import { defineConfig, devices } from "@playwright/test";

const E2E_PASSWORD = "nexus";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3000",
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
      NEXUS_PASSWORD: E2E_PASSWORD,
      NEXUS_PASSWORD_HASH: "",
    },
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
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
