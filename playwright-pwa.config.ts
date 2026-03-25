import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testDir: "./e2e",
  testMatch: /pwa\.spec\.ts/,
  use: {
    ...baseConfig.use,
    serviceWorkers: "allow",
  },
});
