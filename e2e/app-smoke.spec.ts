import { expect, test, type Browser, type Page } from "@playwright/test";
import { appConfig } from "../src/lib/config";

type InitScript = () => void;

async function createVoiceContext(
  browser: Browser,
  initScripts: InitScript[] = [],
) {
  const context = await browser.newContext({
    permissions: ["microphone"],
  });

  for (const initScript of initScripts) {
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

async function clickScreenShare(page: Page) {
  await page
    .getByRole("button", { name: /share screen|take over share/i })
    .click();
}

async function clickStopScreenShare(page: Page) {
  await page.getByRole("button", { name: /stop sharing/i }).click();
}

async function expectScreenStageVideo(page: Page, presenterName: string) {
  await expect(
    page.getByText(new RegExp(`Screen Share: ${presenterName}`, "i")),
  ).toBeVisible();
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const video = document.querySelector('[data-testid="screen-share-video"]');
        if (!(video instanceof HTMLVideoElement)) {
          return null;
        }

        const stream = video.srcObject;
        if (!(stream instanceof MediaStream)) {
          return null;
        }

        return {
          hasSrcObject: true,
          trackCount: stream.getVideoTracks().length,
          trackState: stream.getVideoTracks()[0]?.readyState ?? null,
        };
      });
    })
    .toEqual({
      hasSrcObject: true,
      trackCount: 1,
      trackState: "live",
    });
}

async function expectNoScreenStageVideo(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(() =>
        Boolean(document.querySelector('[data-testid="screen-share-video"]')),
      );
    })
    .toBe(false);
}

async function expectScreenShareIdle(page: Page) {
  await expect(page.getByText(/Presenter: none/i)).toBeVisible();
  await expect(page.getByTestId("screen-stage")).toHaveCount(0);
  await expectNoScreenStageVideo(page);
}

async function expectLocalScreenTrackState(
  page: Page,
  expectedState: "live" | "ended",
) {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const screenShare = (
          window as Window & {
            __nexusScreenShare?: {
              trackReadyState?: string | null;
            };
          }
        ).__nexusScreenShare;

        return screenShare?.trackReadyState ?? null;
      });
    })
    .toBe(expectedState);
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

function installScreenShareMocks() {
  const OriginalWebSocket = window.WebSocket;
  const trackedSockets: WebSocket[] = [];
  Object.defineProperty(window, "__nexusSockets", {
    configurable: true,
    value: trackedSockets,
  });

  class TrackingWebSocket extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      trackedSockets.push(this);
    }
  }

  Object.setPrototypeOf(TrackingWebSocket, OriginalWebSocket);
  window.WebSocket = TrackingWebSocket;

  const screenShareState = {
    starts: 0,
    stream: null as MediaStream | null,
    track: null as MediaStreamTrack | null,
    simulateBrowserStop() {
      const track = this.track;
      if (!track) {
        return null;
      }

      if (track.readyState !== "ended") {
        const nativeStop = (
          track as MediaStreamTrack & {
            __nexusNativeStop?: () => void;
          }
        ).__nexusNativeStop;
        nativeStop?.();
        track.dispatchEvent(new Event("ended"));
      }

      return track.readyState;
    },
    get trackReadyState() {
      return this.track?.readyState ?? null;
    },
  };

  Object.defineProperty(window, "__nexusScreenShare", {
    configurable: true,
    value: screenShareState,
  });

  Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
    configurable: true,
    value: async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;

      const context = canvas.getContext("2d");
      if (!context || typeof canvas.captureStream !== "function") {
        throw new Error("Screen share mock unavailable.");
      }

      const stream = canvas.captureStream(15);
      const [track] = stream.getVideoTracks();
      if (!track) {
        throw new Error("Missing screen share video track.");
      }

      let frame = 0;
      const draw = () => {
        frame += 1;
        context.fillStyle = "#020d07";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#00ff41";
        context.fillRect(64, 64, 320, 160);
        context.fillStyle = "#7dffac";
        context.font = "48px monospace";
        context.fillText(`FRAME ${frame}`, 96, 158);
        context.fillStyle = "#0d2517";
        context.fillRect(64, 280, 1152, 320);
        context.fillStyle = "#b4ffcf";
        context.font = "36px monospace";
        context.fillText("NEXUS SCREEN SHARE", 96, 350);
        context.fillText("Only one presenter at a time", 96, 420);

        if (screenShareState.track?.readyState !== "ended") {
          requestAnimationFrame(draw);
        }
      };

      const nativeStop = track.stop.bind(track);
      Object.defineProperty(track, "__nexusNativeStop", {
        configurable: true,
        value: nativeStop,
      });

      screenShareState.starts += 1;
      screenShareState.stream = stream;
      screenShareState.track = track;
      draw();
      return stream;
    },
  });
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
  const aliceContext = await createVoiceContext(browser, [
    installAutoplayBlocker,
  ]);
  const bobContext = await createVoiceContext(browser, [installAutoplayBlocker]);
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
  const aliceContext = await createVoiceContext(browser, [installPeerTracker]);
  const bobContext = await createVoiceContext(browser, [installPeerTracker]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");
  await expectRemoteAudioPlaying(alicePage);

  await alicePage.evaluate(() => {
    const peer = (
      window as Window & { __nexusPeerConnections?: RTCPeerConnection[] }
    ).__nexusPeerConnections?.[0];
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

test("starts a screen share and renders the inline stage for local and remote viewers", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const bobContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");

  await clickScreenShare(alicePage);
  await expectScreenStageVideo(alicePage, "Alice");
  await expectScreenStageVideo(bobPage, "Alice");
  await expectLocalScreenTrackState(alicePage, "live");

  await aliceContext.close();
  await bobContext.close();
});

test("hands screen share ownership to the latest presenter", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const bobContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");

  await clickScreenShare(alicePage);
  await expectScreenStageVideo(bobPage, "Alice");

  await clickScreenShare(bobPage);
  await expectScreenStageVideo(alicePage, "Bob");
  await expectScreenStageVideo(bobPage, "Bob");
  await expect(alicePage.getByText(/Bob took over screen sharing\./i)).toBeVisible();
  await expectLocalScreenTrackState(alicePage, "ended");
  await expect(alicePage.getByText(/Screen Share: Alice/i)).toHaveCount(0);
  await expect(bobPage.getByText(/Screen Share: Alice/i)).toHaveCount(0);

  await aliceContext.close();
  await bobContext.close();
});

test("stops the active screen share when the browser ends capture", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const bobContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");

  await clickScreenShare(alicePage);
  await expectScreenStageVideo(bobPage, "Alice");

  await alicePage.evaluate(() => {
    const screenShare = (
      window as Window & {
        __nexusScreenShare?: {
          simulateBrowserStop?: () => string | null;
        };
      }
    ).__nexusScreenShare;

    const readyState = screenShare?.simulateBrowserStop?.();
    if (readyState !== "ended") {
      throw new Error("Browser stop did not end the mock screen share.");
    }
  });

  await expectScreenShareIdle(alicePage);
  await expectScreenShareIdle(bobPage);

  await aliceContext.close();
  await bobContext.close();
});

test("connects a late joiner to the active screen share", async ({ browser }) => {
  const aliceContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const bobContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await clickScreenShare(alicePage);
  await expectScreenStageVideo(alicePage, "Alice");

  await login(bobPage, "Bob");
  await expectScreenStageVideo(bobPage, "Alice");

  await aliceContext.close();
  await bobContext.close();
});

test("rejects non-presenter screen share signaling without changing the stage", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const bobContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");

  await clickScreenShare(alicePage);
  await expectScreenStageVideo(alicePage, "Alice");
  await expectScreenStageVideo(bobPage, "Alice");

  await bobPage.evaluate(async () => {
    const response = await fetch("/api/session", {
      credentials: "same-origin",
    });
    const payload = (await response.json()) as {
      user?: {
        id?: string;
      };
    };
    const targetUserId = payload.user?.id;
    if (!targetUserId) {
      throw new Error("Missing target user id.");
    }

    const sockets = (
      window as Window & {
        __nexusSockets?: WebSocket[];
      }
    ).__nexusSockets;
    const socket = sockets?.[sockets.length - 1];
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Missing tracked websocket.");
    }

    socket.send(
      JSON.stringify({
        type: "signal",
        channel: "screen",
        targetUserId,
        signal: {
          type: "offer",
          sdp: {
            type: "offer",
            sdp: "v=0\r\n",
          },
        },
      }),
    );
  });

  await expectScreenStageVideo(alicePage, "Alice");
  await expectScreenStageVideo(bobPage, "Alice");
  await expect(alicePage.getByText(/Screen Share: Bob/i)).toHaveCount(0);
  await expect(bobPage.getByText(/Screen Share: Bob/i)).toHaveCount(0);

  await aliceContext.close();
  await bobContext.close();
});

test("stops the active screen share from the room controls", async ({ browser }) => {
  const aliceContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const bobContext = await createVoiceContext(browser, [installScreenShareMocks]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");

  await clickScreenShare(alicePage);
  await expectScreenStageVideo(alicePage, "Alice");
  await expectScreenStageVideo(bobPage, "Alice");

  await clickStopScreenShare(alicePage);
  await expectScreenShareIdle(alicePage);
  await expectScreenShareIdle(bobPage);

  await aliceContext.close();
  await bobContext.close();
});
