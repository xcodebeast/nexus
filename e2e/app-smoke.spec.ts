import { expect, test, type Browser, type Page } from "@playwright/test";
import { appConfig } from "../src/lib/config";

async function createVoiceContext(
  browser: Browser,
  initScript?: () => void,
) {
  const context = await browser.newContext({
    permissions: ["microphone"],
  });

  if (initScript) {
    await context.addInitScript(initScript);
  }

  return context;
}

async function login(page: Page, username: string) {
  await page.goto("/?skipIntro=1");

  await page.getByRole("button", { name: /connect/i }).click();
  await expect(
    page.getByRole("heading", { name: /> ACCESS TERMINAL/i }),
  ).toBeVisible();

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("nexus");
  await page.getByRole("button", { name: /authenticate/i }).click();
  await expect(page.getByRole("button", { name: /disconnect/i })).toBeVisible();
}

async function measureIntroDuration(page: Page) {
  const connectButton = page.getByRole("button", { name: /connect/i });
  const startTime = Date.now();

  await expect(connectButton).toBeVisible({
    timeout: appConfig.introAnimation.firstVisitDurationMs + 2_000,
  });

  return Date.now() - startTime;
}

async function measureConnectScreenAppearance(page: Page) {
  const connectButton = page.getByRole("button", { name: /connect/i });
  const startTime = Date.now();

  await expect(connectButton).toBeVisible({ timeout: 1_500 });

  return Date.now() - startTime;
}

async function expectRemoteAudioPlaying(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const audio = document.querySelector("audio");
        if (!(audio instanceof HTMLAudioElement)) {
          return null;
        }

        const stream = audio.srcObject;
        return {
          paused: audio.paused,
          hasSrcObject: stream instanceof MediaStream,
          trackCount:
            stream instanceof MediaStream ? stream.getAudioTracks().length : 0,
        };
      });
    })
    .toEqual({
      paused: false,
      hasSrcObject: true,
      trackCount: 1,
    });
}

async function expectGeneratedTurnConfig(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const response = await fetch("/api/session", {
          credentials: "same-origin",
        });
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as {
          rtcConfiguration?: {
            iceServers?: Array<{
              urls: string | string[];
              username?: string;
              credential?: string;
            }>;
          };
        };

        return (payload.rtcConfiguration?.iceServers ?? []).some((server) => {
          const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
          return (
            urls.some((url) => url.includes("turn.cloudflare.com")) &&
            Boolean(server.username) &&
            Boolean(server.credential)
          );
        });
      });
    })
    .toBe(true);
}

function installAutoplayBlocker() {
  let interactionToken = 0;

  document.addEventListener(
    "pointerdown",
    () => {
      interactionToken += 1;
    },
    true,
  );
  document.addEventListener(
    "keydown",
    () => {
      interactionToken += 1;
    },
    true,
  );

  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!(this instanceof HTMLAudioElement) || !this.dataset.peerId) {
      return originalPlay.apply(this, args);
    }

    const blockedToken = Number(this.dataset.blockedInteractionToken ?? "-1");
    if (!this.dataset.autoplayBlockedOnce) {
      this.dataset.autoplayBlockedOnce = "true";
      this.dataset.blockedInteractionToken = String(interactionToken);
      return Promise.reject(
        new DOMException("Blocked remote audio", "NotAllowedError"),
      );
    }

    if (interactionToken <= blockedToken) {
      return Promise.reject(
        new DOMException("Blocked remote audio", "NotAllowedError"),
      );
    }

    return originalPlay.apply(this, args);
  };
}

function installPeerTracker() {
  const OriginalPeerConnection = window.RTCPeerConnection;
  const trackedPeers: RTCPeerConnection[] = [];
  Object.defineProperty(window, "__nexusPeerConnections", {
    configurable: true,
    value: trackedPeers,
  });

  class TrackingPeerConnection extends OriginalPeerConnection {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      trackedPeers.push(this);
    }
  }

  Object.setPrototypeOf(TrackingPeerConnection, OriginalPeerConnection);
  window.RTCPeerConnection = TrackingPeerConnection;
}

test("skips the dedicated intro after the first visit", async ({ browser }) => {
  const context = await createVoiceContext(browser);
  const page = await context.newPage();

  await page.goto("/");
  const firstVisitDurationMs = await measureIntroDuration(page);

  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => window.localStorage.getItem(storageKey),
        appConfig.introAnimation.seenStorageKey,
      ),
    )
    .toBe("true");

  await page.reload();
  const repeatVisitDurationMs = await measureConnectScreenAppearance(page);

  await expect(page.getByText(/^NEXUS$/)).toHaveCount(1);
  expect(firstVisitDurationMs).toBeGreaterThan(3_000);
  expect(repeatVisitDurationMs).toBeLessThan(1_500);

  await context.close();
});

test("authenticates and synchronizes room presence between two clients", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser);
  const bobContext = await createVoiceContext(browser);

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await expect(alicePage.getByText(/1 connected/i)).toBeVisible();
  await expect(alicePage.getByText("Alice (YOU)")).toBeVisible();

  await login(bobPage, "Bob");
  await expect(bobPage.getByText(/2 connected/i)).toBeVisible();
  await expect(bobPage.getByText("Bob (YOU)")).toBeVisible();
  await expect(bobPage.getByText("Alice")).toBeVisible();
  await expect(alicePage.getByText(/2 connected/i)).toBeVisible();
  await expect(alicePage.getByText("Bob")).toBeVisible();
  await expectGeneratedTurnConfig(alicePage);
  await expectGeneratedTurnConfig(bobPage);
  await expectRemoteAudioPlaying(alicePage);
  await expectRemoteAudioPlaying(bobPage);

  await bobPage.getByRole("button", { name: /disconnect/i }).click();
  await expect(alicePage.getByText(/1 connected/i)).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});

test("retries blocked remote audio playback after the next user interaction", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, installAutoplayBlocker);
  const bobContext = await createVoiceContext(browser, installAutoplayBlocker);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");

  await expect(
    alicePage.getByText(/remote audio is waiting for a browser interaction/i),
  ).toBeVisible();

  await alicePage.mouse.click(10, 10);
  await expect(
    alicePage.getByText(/remote audio is waiting for a browser interaction/i),
  ).toBeHidden();
  await expectRemoteAudioPlaying(alicePage);

  await aliceContext.close();
  await bobContext.close();
});

test("shows a peer audio connection error when the media path fails", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, installPeerTracker);
  const bobContext = await createVoiceContext(browser, installPeerTracker);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");
  await expectRemoteAudioPlaying(alicePage);

  await alicePage.evaluate(() => {
    const peer = (window as Window & { __nexusPeerConnections?: RTCPeerConnection[] })
      .__nexusPeerConnections?.[0];
    if (!peer) {
      throw new Error("Missing tracked peer connection.");
    }

    Object.defineProperty(peer, "connectionState", {
      configurable: true,
      get: () => "failed",
    });
    Object.defineProperty(peer, "iceConnectionState", {
      configurable: true,
      get: () => "failed",
    });

    peer.dispatchEvent(new Event("iceconnectionstatechange"));
    peer.dispatchEvent(new Event("connectionstatechange"));
  });

  await expect(
    alicePage.getByText(/peer audio connection failed\. check network access and reconnect\./i),
  ).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});

test("shows a clear error when microphone APIs are unavailable", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
  });

  const page = await context.newPage();

  await login(page, "Alice");
  await expect(
    page.getByText(/microphone access (requires https or localhost|is unavailable)/i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /disconnect/i })).toBeVisible();

  await context.close();
});
