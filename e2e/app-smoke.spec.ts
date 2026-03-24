import { expect, test, type Browser, type Page } from "@playwright/test";
import { appConfig } from "../src/lib/config";

type InitScript = () => void;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

async function expectRoomPresence(
  page: Page,
  connectionCount: number,
  usernames: string[],
) {
  await expect(
    page.getByText(new RegExp(`${connectionCount} connected`, "i")),
  ).toBeVisible();

  for (const username of usernames) {
    await expect(page.getByText(username)).toBeVisible();
  }
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

async function expectNoRemoteAudio(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(() =>
        document.querySelectorAll("audio[data-peer-id]").length,
      );
    })
    .toBe(0);
}

async function expectParticipantAfk(page: Page, username: string) {
  await expect(
    page.getByRole("status", {
      name: new RegExp(`${escapeRegExp(username)} is AFK`, "i"),
    }),
  ).toBeVisible();
}

async function expectParticipantNotAfk(page: Page, username: string) {
  await expect(
    page.getByRole("status", {
      name: new RegExp(`${escapeRegExp(username)} is AFK`, "i"),
    }),
  ).toHaveCount(0);
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

async function expectMicProcessingLabelHidden(page: Page) {
  await expect(page.getByText(/Mic:\s+(enhanced|standard)/i)).toHaveCount(0);
}

async function expectAudioWorkletAttempted(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return (
          (
            window as Window & {
              __nexusAudioWorklet?: { addModuleCallCount?: number };
            }
          ).__nexusAudioWorklet?.addModuleCallCount ?? 0
        );
      });
    })
    .toBeGreaterThan(0);
}

async function clickScreenShare(page: Page) {
  await page
    .getByRole("button", { name: /share screen|take over share/i })
    .click();
}

async function clickStopScreenShare(page: Page) {
  await page.getByRole("button", { name: /stop sharing/i }).click();
}

async function clickAfk(page: Page) {
  await page
    .getByRole("button", { name: /go afk|return from afk/i })
    .click();
}

async function getShortcutModifierLabel(page: Page) {
  return page.evaluate(() => {
    const navigatorWithUserAgentData = navigator as Navigator & {
      userAgentData?: {
        platform?: string;
      };
    };
    const platform =
      navigatorWithUserAgentData.userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent;

    return /mac/i.test(platform) ? "Control" : "Ctrl";
  });
}

async function holdShortcutRevealModifier(page: Page) {
  await page.keyboard.down("Control");
}

async function releaseShortcutRevealModifier(page: Page) {
  await page.keyboard.up("Control");
}

async function triggerRoomShortcut(
  page: Page,
  key: "KeyM" | "KeyF" | "KeyS" | "KeyD",
) {
  await holdShortcutRevealModifier(page);
  await page.keyboard.press(key);
  await releaseShortcutRevealModifier(page);
}

async function expectRoomControlTooltipVisible(
  page: Page,
  actionId: "mute" | "afk" | "screenShare" | "disconnect",
) {
  await expect(page.getByTestId(`room-control-tooltip-${actionId}`)).toBeVisible();
}

async function expectRoomControlTooltipHidden(
  page: Page,
  actionId: "mute" | "afk" | "screenShare" | "disconnect",
) {
  await expect(page.getByTestId(`room-control-tooltip-${actionId}`)).toHaveCount(0);
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
  await expect(page.getByTestId("screen-stage")).toHaveCount(0);
  await expectNoScreenStageVideo(page);
}

async function expectNoScreenSignalError(page: Page) {
  await expect(
    page.getByText(/screen sharing signals must be exchanged with the active presenter\./i),
  ).toHaveCount(0);
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

function installWebSocketTracker() {
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
}

function installAudioWorkletPassThrough() {
  const audioWorkletState = {
    addModuleCallCount: 0,
  };
  Object.defineProperty(window, "__nexusAudioWorklet", {
    configurable: true,
    value: audioWorkletState,
  });

  if ("AudioWorklet" in window) {
    window.AudioWorklet.prototype.addModule = async function () {
      audioWorkletState.addModuleCallCount += 1;
    };
  }

  class MockAudioWorkletNode extends GainNode {
    port = {
      postMessage() {},
    };

    constructor(context: BaseAudioContext) {
      super(context);
    }
  }

  Object.defineProperty(window, "AudioWorkletNode", {
    configurable: true,
    value: MockAudioWorkletNode,
  });
}

function installAudioWorkletModuleFailure() {
  const audioWorkletState = {
    addModuleCallCount: 0,
  };
  Object.defineProperty(window, "__nexusAudioWorklet", {
    configurable: true,
    value: audioWorkletState,
  });

  if (!("AudioWorklet" in window)) {
    return;
  }

  window.AudioWorklet.prototype.addModule = async () => {
    audioWorkletState.addModuleCallCount += 1;
    throw new Error("Simulated RNNoise worklet load failure.");
  };
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

test("authenticates and synchronizes room presence across three clients", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser);
  const bobContext = await createVoiceContext(browser);
  const carolContext = await createVoiceContext(browser);

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const carolPage = await carolContext.newPage();

  await login(alicePage, "Alice");
  await expectRoomPresence(alicePage, 1, ["Alice (YOU)"]);

  await login(bobPage, "Bob");
  await expectRoomPresence(bobPage, 2, ["Bob (YOU)", "Alice"]);
  await expectRoomPresence(alicePage, 2, ["Alice (YOU)", "Bob"]);
  await expectGeneratedTurnConfig(alicePage);
  await expectGeneratedTurnConfig(bobPage);
  await expectRemoteAudioPlaying(alicePage);
  await expectRemoteAudioPlaying(bobPage);

  await login(carolPage, "Carol");
  await expectRoomPresence(carolPage, 3, ["Carol (YOU)", "Alice", "Bob"]);
  await expectRoomPresence(alicePage, 3, ["Alice (YOU)", "Bob", "Carol"]);
  await expectRoomPresence(bobPage, 3, ["Bob (YOU)", "Alice", "Carol"]);
  await expectGeneratedTurnConfig(carolPage);
  await expectRemoteAudioPlaying(carolPage);

  await bobPage.getByRole("button", { name: /disconnect/i }).click();
  await expectRoomPresence(alicePage, 2, ["Alice (YOU)", "Carol"]);
  await expectRoomPresence(carolPage, 2, ["Carol (YOU)", "Alice"]);

  await aliceContext.close();
  await bobContext.close();
  await carolContext.close();
});

test("reconnects a dropped realtime client back into a three-user room", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [installWebSocketTracker]);
  const bobContext = await createVoiceContext(browser, [installWebSocketTracker]);
  const carolContext = await createVoiceContext(browser, [installWebSocketTracker]);

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const carolPage = await carolContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");
  await login(carolPage, "Carol");

  await expectRoomPresence(alicePage, 3, ["Alice (YOU)", "Bob", "Carol"]);
  await expectRoomPresence(bobPage, 3, ["Bob (YOU)", "Alice", "Carol"]);
  await expectRoomPresence(carolPage, 3, ["Carol (YOU)", "Alice", "Bob"]);

  await carolPage.evaluate(() => {
    const sockets = (
      window as Window & {
        __nexusSockets?: WebSocket[];
      }
    ).__nexusSockets;
    const socket = [...(sockets ?? [])]
      .reverse()
      .find((candidate) => candidate.url.includes("/api/ws"));
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Missing tracked room websocket.");
    }

    socket.close(4005, "Simulated realtime drop");
  });

  await expect(
    carolPage.getByText(/realtime connection lost\. reconnecting/i),
  ).toBeVisible();
  await expectRoomPresence(carolPage, 3, ["Carol (YOU)", "Alice", "Bob"]);
  await expectRoomPresence(alicePage, 3, ["Alice (YOU)", "Bob", "Carol"]);
  await expectRoomPresence(bobPage, 3, ["Bob (YOU)", "Alice", "Carol"]);
  await expectRemoteAudioPlaying(carolPage);

  await aliceContext.close();
  await bobContext.close();
  await carolContext.close();
});

test("initializes RNNoise without showing a mic mode label", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installAudioWorkletPassThrough,
  ]);
  const bobContext = await createVoiceContext(browser, [
    installAudioWorkletPassThrough,
  ]);

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");

  await expectMicProcessingLabelHidden(alicePage);
  await expectMicProcessingLabelHidden(bobPage);
  await expectAudioWorkletAttempted(alicePage);
  await expectAudioWorkletAttempted(bobPage);
  await expectRemoteAudioPlaying(alicePage);
  await expectRemoteAudioPlaying(bobPage);

  await aliceContext.close();
  await bobContext.close();
});

test("falls back without showing a mic mode label when RNNoise cannot start", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installAudioWorkletModuleFailure,
  ]);
  const bobContext = await createVoiceContext(browser, [
    installAudioWorkletModuleFailure,
  ]);

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");

  await expectMicProcessingLabelHidden(alicePage);
  await expectMicProcessingLabelHidden(bobPage);
  await expectAudioWorkletAttempted(alicePage);
  await expectAudioWorkletAttempted(bobPage);
  await expectRemoteAudioPlaying(alicePage);
  await expectRemoteAudioPlaying(bobPage);

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

test("AFK keeps room presence while disconnecting audio until return", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser);
  const bobContext = await createVoiceContext(browser);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");

  await expectRemoteAudioPlaying(alicePage);
  await expectRemoteAudioPlaying(bobPage);

  await clickAfk(alicePage);

  await expectRoomPresence(alicePage, 2, ["Alice (YOU)", "Bob"]);
  await expectRoomPresence(bobPage, 2, ["Bob (YOU)", "Alice"]);
  await expect(alicePage.getByText(/AFK: mic and room audio paused\./i)).toBeVisible();
  await expect(
    alicePage.getByRole("button", { name: /unmute microphone/i }),
  ).toBeDisabled();
  await expectParticipantAfk(alicePage, "Alice (YOU)");
  await expectParticipantAfk(bobPage, "Alice");
  await expectNoRemoteAudio(alicePage);
  await expectNoRemoteAudio(bobPage);
  await expect(
    alicePage.getByText(/peer audio connection failed/i),
  ).toHaveCount(0);
  await expect(
    bobPage.getByText(/peer audio connection failed/i),
  ).toHaveCount(0);

  await clickAfk(alicePage);

  await expect(alicePage.getByText(/AFK: mic and room audio paused\./i)).toHaveCount(0);
  await expectParticipantNotAfk(alicePage, "Alice (YOU)");
  await expectParticipantNotAfk(bobPage, "Alice");
  await expect(
    alicePage.getByRole("button", { name: /mute microphone/i }),
  ).toBeEnabled();
  await expectRemoteAudioPlaying(alicePage);
  await expectRemoteAudioPlaying(bobPage);

  await aliceContext.close();
  await bobContext.close();
});

test("shortcut hints and tooltips are discoverable on room controls", async ({
  browser,
}) => {
  const context = await createVoiceContext(browser);
  const page = await context.newPage();

  await login(page, "Alice");
  const modifierLabel = await getShortcutModifierLabel(page);
  const hoverDelayMs = appConfig.roomControls.shortcuts.tooltip.hoverDelayMs;
  const revealDelayMs = appConfig.roomControls.shortcuts.tooltip.revealDelayMs;

  await expectRoomControlTooltipHidden(page, "mute");
  await expectRoomControlTooltipHidden(page, "afk");
  await expectRoomControlTooltipHidden(page, "screenShare");
  await expectRoomControlTooltipHidden(page, "disconnect");

  await holdShortcutRevealModifier(page);
  await page.waitForTimeout(Math.max(0, revealDelayMs - 40));
  await expectRoomControlTooltipHidden(page, "mute");
  await page.waitForTimeout(60);
  await expectRoomControlTooltipVisible(page, "mute");
  await expectRoomControlTooltipVisible(page, "afk");
  await expectRoomControlTooltipVisible(page, "screenShare");
  await expectRoomControlTooltipVisible(page, "disconnect");
  const shortcutRevealTooltip = page.getByTestId("room-control-tooltip-mute");
  await expect(shortcutRevealTooltip).toContainText("M");
  await expect(shortcutRevealTooltip).not.toContainText(modifierLabel);
  await expect(shortcutRevealTooltip).not.toContainText(/mute microphone/i);
  await releaseShortcutRevealModifier(page);

  await expectRoomControlTooltipHidden(page, "mute");
  await expectRoomControlTooltipHidden(page, "afk");
  await expectRoomControlTooltipHidden(page, "screenShare");
  await expectRoomControlTooltipHidden(page, "disconnect");

  await page.getByTestId("room-control-mute").hover();
  await page.waitForTimeout(Math.max(0, hoverDelayMs - 40));
  await expectRoomControlTooltipHidden(page, "mute");
  await page.waitForTimeout(60);
  const hoverTooltip = page.getByTestId("room-control-tooltip-mute");
  await expect(hoverTooltip).toContainText(/mute microphone/i);
  await expect(hoverTooltip).toContainText(modifierLabel);
  await expect(hoverTooltip).toContainText("M");

  await context.close();
});

test("shortcuts drive mute, AFK, and disconnect room controls", async ({
  browser,
}) => {
  const context = await createVoiceContext(browser);
  const page = await context.newPage();

  await login(page, "Alice");

  await triggerRoomShortcut(page, "KeyM");
  await expect(
    page.getByRole("button", { name: /unmute microphone/i }),
  ).toBeVisible();

  await triggerRoomShortcut(page, "KeyM");
  await expect(
    page.getByRole("button", { name: /mute microphone/i }),
  ).toBeVisible();

  await triggerRoomShortcut(page, "KeyF");
  await expect(page.getByText(/AFK: mic and room audio paused\./i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /unmute microphone/i }),
  ).toBeDisabled();

  await triggerRoomShortcut(page, "KeyM");
  await expect(
    page.getByRole("button", { name: /unmute microphone/i }),
  ).toBeDisabled();
  await expect(page.getByText(/AFK: mic and room audio paused\./i)).toBeVisible();

  await triggerRoomShortcut(page, "KeyF");
  await expect(page.getByText(/AFK: mic and room audio paused\./i)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /mute microphone/i }),
  ).toBeEnabled();

  await triggerRoomShortcut(page, "KeyD");
  await expect(page.getByRole("button", { name: /connect/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /disconnect/i })).toHaveCount(0);

  await context.close();
});

test("AFK stops active screen sharing and blocks restarting until return", async ({
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

  await clickAfk(alicePage);

  await expectParticipantAfk(bobPage, "Alice");
  await expectScreenShareIdle(alicePage);
  await expectScreenShareIdle(bobPage);
  await expect(
    alicePage.getByRole("button", { name: /share screen/i }),
  ).toBeDisabled();

  await clickAfk(alicePage);

  await expectParticipantNotAfk(bobPage, "Alice");
  await expect(
    alicePage.getByRole("button", { name: /share screen/i }),
  ).toBeEnabled();

  await aliceContext.close();
  await bobContext.close();
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
  await expectNoScreenSignalError(alicePage);
  await expectNoScreenSignalError(bobPage);

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
  await expectNoScreenSignalError(alicePage);
  await expectNoScreenSignalError(bobPage);

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

test("shortcut starts and stops screen sharing", async ({ browser }) => {
  const context = await createVoiceContext(browser, [installScreenShareMocks]);
  const page = await context.newPage();

  await login(page, "Alice");

  await triggerRoomShortcut(page, "KeyS");
  await expectScreenStageVideo(page, "Alice");

  await triggerRoomShortcut(page, "KeyS");
  await expectScreenShareIdle(page);

  await context.close();
});
