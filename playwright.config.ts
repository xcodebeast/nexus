import { defineConfig, devices } from "@playwright/test";

const E2E_PASSWORD = "nexus";
const E2E_PORT = "3100";
const E2E_CLOUDFLARE_TURN_MOCK_ICE_SERVERS = JSON.stringify({
  iceServers: [
    {
      urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"],
    },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp",
        "turns:turn.cloudflare.com:5349?transport=tcp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turn:turn.cloudflare.com:80?transport=tcp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "playwright-turn-user",
      credential: "playwright-turn-secret",
    },
  ],
});

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
      CLOUDFLARE_TURN_KEY_ID: "playwright-turn-key",
      CLOUDFLARE_TURN_API_TOKEN: "playwright-turn-api-token",
      CLOUDFLARE_TURN_MOCK_ICE_SERVERS: E2E_CLOUDFLARE_TURN_MOCK_ICE_SERVERS,
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
