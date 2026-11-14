import { expect, test, type Browser, type Page } from "@playwright/test";
import { appConfig } from "../src/lib/config";
import type { NotificationCue } from "../src/lib/audio/notification-sounds";
import type { BoardSnapshot, BoardUpdate } from "../src/lib/whiteboard";

interface CameraHarness {
  requests: number;
  offers: number;
  tracks: MediaStreamTrack[];
  defer: boolean;
  deny: boolean;
  resolve: (() => void) | null;
}

declare global {
  interface Window {
    __nexusCamera: CameraHarness;
    __nexusPeerConnections: RTCPeerConnection[];
    __nexusBoard: {
      snapshot: BoardSnapshot | null;
      updates: BoardUpdate[];
      sent: Array<{ message: Record<string, any>; bytes: number; time: number }>;
    };
  }
}

function installWhiteboardTracker() {
  const Original = window.WebSocket;
  const state: Window["__nexusBoard"] = {
    snapshot: null,
    updates: [],
    sent: [],
  };
  window.__nexusBoard = state;
  window.WebSocket = class extends Original {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener("message", (event) => {
        if (!this.url.includes("/api/ws") || typeof event.data !== "string")
          return;
        const message = JSON.parse(event.data);
        if (message.type === "whiteboard:snapshot")
          state.snapshot = message.snapshot;
        if (message.type === "whiteboard:update")
          state.updates.push(message.update);
      });
    }
    override send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.url.includes("/api/ws") && typeof data === "string") {
        const message = JSON.parse(data);
        if (message.type === "whiteboard:command")
          state.sent.push({
            message,
            bytes: new TextEncoder().encode(data).length,
            time: performance.now(),
          });
      }
      super.send(data);
    }
  };
}

async function openWhiteboard(page: Page) {
  await page
    .getByRole("button", { name: "Open whiteboard", exact: true })
    .click();
  await expect(page.getByLabel("Use pen", { exact: true })).toBeEnabled();
}

async function drawBoardLine(
  page: Page,
  from: [number, number],
  to: [number, number],
  steps = 20,
) {
  const rect = await page
    .getByLabel("Collaborative whiteboard", { exact: true })
    .boundingBox();
  if (!rect) throw new Error("Whiteboard is missing");
  await page.mouse.move(
    rect.x + rect.width * from[0],
    rect.y + rect.height * from[1],
  );
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width * to[0],
    rect.y + rect.height * to[1],
    { steps },
  );
  await page.mouse.up();
}

async function boardPixel(page: Page, x: number, y: number) {
  return page.getByLabel("Collaborative whiteboard", { exact: true }).evaluate(
    (element: HTMLCanvasElement, point) => {
      const context = element.getContext("2d")!;
      return [
        ...context.getImageData(
          Math.floor(element.width * point.x),
          Math.floor(element.height * point.y),
          1,
          1,
        ).data,
      ];
    },
    { x, y },
  );
}

function installCameraHarness() {
  const state: CameraHarness = {
    requests: 0,
    offers: 0,
    tracks: [],
    defer: false,
    deny: false,
    resolve: null,
  };
  window.__nexusCamera = state;
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (!constraints?.video) return getUserMedia(constraints);
    state.requests += 1;
    if (state.deny) throw new DOMException("Denied", "NotAllowedError");
    if (state.defer)
      await new Promise<void>((resolve) => {
        state.resolve = resolve;
      });
    const stream = await getUserMedia(constraints);
    state.tracks.push(...stream.getVideoTracks());
    return stream;
  };
  const createOffer = RTCPeerConnection.prototype.createOffer;
  RTCPeerConnection.prototype.createOffer = new Proxy(createOffer, {
    apply(target, receiver, args) {
      state.offers += 1;
      return Reflect.apply(target, receiver, args);
    },
  });
}

async function expectCameraPlaying(page: Page, username: string) {
  const video = page.getByLabel(`${username} camera`, { exact: true });
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate(
        (element: HTMLVideoElement) =>
          element.videoWidth > 0 &&
          !element.paused &&
          element.getVideoPlaybackQuality().totalVideoFrames > 1,
      ),
    )
    .toBe(true);
}

async function getCameraSenders(page: Page) {
  return page.evaluate(() =>
    window.__nexusPeerConnections
      .filter((peer) => peer.connectionState !== "closed")
      .flatMap((peer) =>
        peer
          .getTransceivers()
          .filter((entry) => entry.receiver.track.kind === "video")
          .map(({ sender }) => ({
            trackState: sender.track?.readyState ?? null,
            encoding: sender.getParameters().encodings[0],
          })),
      ),
  );
}

type InitScript = () => void;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createVoiceContext(
  browser: Browser,
  initScripts: InitScript[] = [],
) {
  const context = await browser.newContext({
    permissions: ["microphone", "camera"],
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

async function getNotificationSoundLog(page: Page) {
  return page.evaluate(() => {
    return [
      ...(
        (window as Window & {
          __nexusNotificationSounds?: NotificationCue[];
        }).__nexusNotificationSounds ?? []
      ),
    ];
  });
}

async function clearNotificationSoundLog(page: Page) {
  await page.evaluate(() => {
    const soundLog = (
      window as Window & {
        __nexusNotificationSounds?: NotificationCue[];
      }
    ).__nexusNotificationSounds;

    if (soundLog) {
      soundLog.length = 0;
    }
  });
}

async function expectNotificationSoundLog(
  page: Page,
  expectedCues: NotificationCue[],
) {
  await expect.poll(() => getNotificationSoundLog(page)).toEqual(expectedCues);
}

async function expectMicrophoneCaptureState(
  page: Page,
  expected: {
    requestCount: number;
    liveTrackCount: number;
    endedTrackCount: number;
  },
) {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const microphoneCapture = (
          window as Window & {
            __nexusMicrophoneCapture?: {
              requestCount: number;
              liveTrackCount: number;
              endedTrackCount: number;
            };
          }
        ).__nexusMicrophoneCapture;

        return microphoneCapture
          ? {
              requestCount: microphoneCapture.requestCount,
              liveTrackCount: microphoneCapture.liveTrackCount,
              endedTrackCount: microphoneCapture.endedTrackCount,
            }
          : null;
      });
    })
    .toEqual(expected);
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

async function openAudioSettings(page: Page) {
  await page.getByTestId("audio-settings-trigger").click();
  await expect(
    page.getByRole("dialog", { name: /audio settings/i }),
  ).toBeVisible();
}

async function expectAudioSettingsSelections(
  page: Page,
  expected: { microphoneId: string; speakerId: string },
) {
  await expect(page.getByTestId("audio-settings-microphone-select")).toHaveValue(
    expected.microphoneId,
  );
  await expect(page.getByTestId("audio-settings-speaker-select")).toHaveValue(
    expected.speakerId,
  );
}

async function getRequestedMicrophoneDeviceIds(page: Page) {
  return page.evaluate(() => {
    const microphoneCapture = (
      window as Window & {
        __nexusMicrophoneCapture?: {
          requestedDeviceIds?: string[];
        };
      }
    ).__nexusMicrophoneCapture;

    return [...(microphoneCapture?.requestedDeviceIds ?? [])];
  });
}

async function expectRemoteAudioSinkId(page: Page, expectedSinkId: string) {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const audio = document.querySelector("audio[data-peer-id]");
        if (!(audio instanceof HTMLAudioElement)) {
          return null;
        }

        return (
          (
            audio as HTMLAudioElement & {
              sinkId?: string;
            }
          ).sinkId ?? ""
        );
      });
    })
    .toBe(expectedSinkId);
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

function installNotificationSoundTracker() {
  const soundLog: string[] = [];
  Object.defineProperty(window, "__nexusNotificationSounds", {
    configurable: true,
    writable: true,
    value: soundLog,
  });

  window.addEventListener("nexus:notification-sound", (event) => {
    const cue = (event as CustomEvent<{ cue?: string }>).detail?.cue;
    if (typeof cue === "string") {
      soundLog.push(cue);
    }
  });
}

function installMicrophoneCaptureTracker() {
  let requestCount = 0;
  const trackedTracks = new Map<string, MediaStreamTrack>();
  const endedTrackIds = new Set<string>();
  const requestedDeviceIds: string[] = [];
  const originalGetUserMedia =
    navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  Object.defineProperty(window, "__nexusMicrophoneCapture", {
    configurable: true,
    get: () => ({
      requestCount,
      liveTrackCount: [...trackedTracks.values()].filter(
        (track) => track.readyState === "live",
      ).length,
      endedTrackCount: endedTrackIds.size,
      requestedDeviceIds,
    }),
  });

  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    configurable: true,
    value: async (constraints?: MediaStreamConstraints) => {
      const passthroughConstraints =
        typeof constraints?.audio === "object"
          ? {
              ...constraints,
              audio: {
                ...constraints.audio,
              },
            }
          : constraints;

      if (!constraints?.audio) {
        return originalGetUserMedia(constraints);
      }

      requestCount += 1;
      if (typeof constraints.audio === "object") {
        const deviceIdConstraint = constraints.audio.deviceId;
        if (typeof deviceIdConstraint === "string") {
          requestedDeviceIds.push(deviceIdConstraint);
        } else if (
          deviceIdConstraint &&
          typeof deviceIdConstraint === "object"
        ) {
          requestedDeviceIds.push(
            typeof deviceIdConstraint.exact === "string"
              ? deviceIdConstraint.exact
              : typeof deviceIdConstraint.ideal === "string"
                ? deviceIdConstraint.ideal
                : "",
          );
        } else {
          requestedDeviceIds.push("");
        }
      } else {
        requestedDeviceIds.push("");
      }

      if (
        passthroughConstraints &&
        typeof passthroughConstraints.audio === "object"
      ) {
        delete passthroughConstraints.audio.deviceId;
      }

      const stream = await originalGetUserMedia(passthroughConstraints);

      for (const track of stream.getAudioTracks()) {
        trackedTracks.set(track.id, track);

        const nativeStop = track.stop.bind(track);
        Object.defineProperty(track, "stop", {
          configurable: true,
          value: () => {
            nativeStop();
            endedTrackIds.add(track.id);
          },
        });
        track.addEventListener("ended", () => {
          endedTrackIds.add(track.id);
        });
      }

      return stream;
    },
  });
}

function installAudioDeviceMocks() {
  const devices = [
    {
      deviceId: "mic-alpha",
      groupId: "group-mic-alpha",
      kind: "audioinput",
      label: "Matrix Mic Alpha",
      toJSON() {
        return this;
      },
    },
    {
      deviceId: "mic-beta",
      groupId: "group-mic-beta",
      kind: "audioinput",
      label: "Matrix Mic Beta",
      toJSON() {
        return this;
      },
    },
    {
      deviceId: "speaker-alpha",
      groupId: "group-speaker-alpha",
      kind: "audiooutput",
      label: "Matrix Speakers Alpha",
      toJSON() {
        return this;
      },
    },
    {
      deviceId: "speaker-beta",
      groupId: "group-speaker-beta",
      kind: "audiooutput",
      label: "Matrix Speakers Beta",
      toJSON() {
        return this;
      },
    },
  ] satisfies MediaDeviceInfo[];

  Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
    configurable: true,
    value: async () => devices,
  });

  (
    HTMLMediaElement.prototype as HTMLMediaElement & {
      setSinkId?: (sinkId: string) => Promise<void>;
    }
  ).setSinkId = async function (sinkId: string) {
    Object.defineProperty(this, "sinkId", {
      configurable: true,
      writable: true,
      value: sinkId,
    });
  };
}

function installAudioDeviceMocksWithoutSpeakerSelection() {
  const devices = [
    {
      deviceId: "mic-alpha",
      groupId: "group-mic-alpha",
      kind: "audioinput",
      label: "Matrix Mic Alpha",
      toJSON() {
        return this;
      },
    },
    {
      deviceId: "mic-beta",
      groupId: "group-mic-beta",
      kind: "audioinput",
      label: "Matrix Mic Beta",
      toJSON() {
        return this;
      },
    },
    {
      deviceId: "speaker-alpha",
      groupId: "group-speaker-alpha",
      kind: "audiooutput",
      label: "Matrix Speakers Alpha",
      toJSON() {
        return this;
      },
    },
    {
      deviceId: "speaker-beta",
      groupId: "group-speaker-beta",
      kind: "audiooutput",
      label: "Matrix Speakers Beta",
      toJSON() {
        return this;
      },
    },
  ] satisfies MediaDeviceInfo[];

  Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
    configurable: true,
    value: async () => devices,
  });

  (
    HTMLMediaElement.prototype as HTMLMediaElement & {
      setSinkId?: (sinkId: string) => Promise<void>;
    }
  ).setSinkId = async function () {
    throw new Error(
      "Speaker selection is available in supported Chromium-based browsers.",
    );
  };
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

test("camera sends real video both ways without new peers or renegotiation", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installPeerTracker,
    installCameraHarness,
  ]);
  const bobContext = await createVoiceContext(browser, [
    installPeerTracker,
    installCameraHarness,
  ]);
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  try {
    await login(alice, "Alice");
    await login(bob, "Bob");
    await expectRemoteAudioPlaying(alice);
    await expectRemoteAudioPlaying(bob);
    const before = await Promise.all(
      [alice, bob].map((page) =>
        page.evaluate(() => ({
          peers: window.__nexusPeerConnections.length,
          offers: window.__nexusCamera.offers,
          requests: window.__nexusCamera.requests,
        })),
      ),
    );
    expect(
      before.every((entry) => entry.peers === 1 && entry.requests === 0),
    ).toBe(true);

    await alice
      .getByRole("button", { name: "Turn camera on", exact: true })
      .click();
    await bob
      .getByRole("button", { name: "Turn camera on", exact: true })
      .click();
    await expectCameraPlaying(alice, "Alice (YOU)");
    await expectCameraPlaying(bob, "Alice");
    await expectCameraPlaying(alice, "Bob");
    await expectCameraPlaying(bob, "Bob (YOU)");
    for (const page of [alice, bob]) {
      const senders = await getCameraSenders(page);
      expect(senders).toHaveLength(1);
      expect(senders[0]?.encoding).toMatchObject({
        maxBitrate: 300_000,
        maxFramerate: 15,
      });
      const settings = await page.evaluate(() =>
        window.__nexusCamera.tracks[0]!.getSettings(),
      );
      expect(settings.width).toBeLessThanOrEqual(640);
      expect(settings.height).toBeLessThanOrEqual(360);
      expect(settings.frameRate).toBeLessThanOrEqual(15);
    }

    await alice
      .getByRole("button", { name: "Mute microphone", exact: true })
      .click();
    await expectCameraPlaying(bob, "Alice");
    await alice
      .getByRole("button", { name: "Turn camera off", exact: true })
      .click();
    await expect(bob.getByLabel("Alice camera", { exact: true })).toHaveCount(
      0,
    );
    await expect
      .poll(() =>
        alice.evaluate(() => window.__nexusCamera.tracks[0]?.readyState),
      )
      .toBe("ended");
    await expect
      .poll(() => getCameraSenders(alice))
      .toMatchObject([{ trackState: null }]);
    await alice.getByTestId("room-control-camera").focus();
    await alice.keyboard.press("Control+e");
    await expectCameraPlaying(bob, "Alice");
    await expectRemoteAudioPlaying(bob);
    const after = await Promise.all(
      [alice, bob].map((page) =>
        page.evaluate(() => ({
          peers: window.__nexusPeerConnections.length,
          offers: window.__nexusCamera.offers,
        })),
      ),
    );
    expect(after).toEqual(
      before.map(({ peers, offers }) => ({ peers, offers })),
    );
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("camera connects late viewers and reallocates bandwidth on AFK and leave", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      createVoiceContext(browser, [installPeerTracker, installCameraHarness]),
    ),
  );
  try {
    const pages = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    const alice = pages[0]!;
    await login(alice, "Alice");
    await alice
      .getByRole("button", { name: "Turn camera on", exact: true })
      .click();
    await expectCameraPlaying(alice, "Alice (YOU)");
    for (const [index, page] of pages.slice(1).entries()) {
      await login(page, `Viewer ${index + 1}`);
      await expectCameraPlaying(page, "Alice");
    }
    await expect
      .poll(async () =>
        (await getCameraSenders(alice)).map(
          (sender) => sender.encoding?.maxBitrate,
        ),
      )
      .toEqual([200_000, 200_000, 200_000]);
    await pages[1]!
      .getByRole("button", { name: "Go AFK", exact: true })
      .click();
    await expect(
      pages[1]!.getByLabel("Alice camera", { exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(async () =>
        (await getCameraSenders(alice)).map(
          (sender) => sender.encoding?.maxBitrate,
        ),
      )
      .toEqual([300_000, 300_000]);
    await pages[1]!
      .getByRole("button", { name: "Return from AFK", exact: true })
      .click();
    await expectCameraPlaying(pages[1]!, "Alice");
    await expect
      .poll(async () =>
        (await getCameraSenders(alice)).map(
          (sender) => sender.encoding?.maxBitrate,
        ),
      )
      .toEqual([200_000, 200_000, 200_000]);
    await pages[3]!
      .getByRole("button", { name: "Disconnect", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await getCameraSenders(alice)).map(
          (sender) => sender.encoding?.maxBitrate,
        ),
      )
      .toEqual([300_000, 300_000]);
    await alice.getByRole("button", { name: "Go AFK", exact: true }).click();
    await expect
      .poll(() =>
        alice.evaluate(() => window.__nexusCamera.tracks[0]?.readyState),
      )
      .toBe("ended");
    await alice
      .getByRole("button", { name: "Return from AFK", exact: true })
      .click();
    await expect(
      alice.getByRole("button", { name: "Turn camera on", exact: true }),
    ).toBeEnabled();
    await expect(alice.getByTestId("camera-video")).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("camera permission failure leaves voice connected and allows retry", async ({
  browser,
}) => {
  const context = await createVoiceContext(browser, [installCameraHarness]);
  const page = await context.newPage();
  try {
    await login(page, "Alice");
    await page.evaluate(() => {
      window.__nexusCamera.deny = true;
    });
    await page
      .getByRole("button", { name: "Turn camera on", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Camera access was denied",
    );
    await expect(page.getByText(/Voice channel active/)).toBeVisible();
    await page.evaluate(() => {
      window.__nexusCamera.deny = false;
    });
    await page
      .getByRole("button", { name: "Turn camera on", exact: true })
      .click();
    await expectCameraPlaying(page, "Alice (YOU)");
  } finally {
    await context.close();
  }
});

for (const action of ["cancel", "afk", "disconnect", "reconnect"] as const) {
  test(`camera discards a permission result after ${action}`, async ({
    browser,
  }) => {
    const context = await createVoiceContext(browser, [
      installCameraHarness,
      installWebSocketTracker,
    ]);
    const page = await context.newPage();
    try {
      await login(page, "Alice");
      await expect(
        page.getByRole("button", { name: "Turn camera on", exact: true }),
      ).toBeEnabled();
      await page.evaluate(() => {
        window.__nexusCamera.defer = true;
      });
      await page
        .getByRole("button", { name: "Turn camera on", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => Boolean(window.__nexusCamera.resolve)))
        .toBe(true);
      if (action === "cancel")
        await page
          .getByRole("button", { name: "Cancel camera request" })
          .click();
      if (action === "afk")
        await page.getByRole("button", { name: "Go AFK", exact: true }).click();
      if (action === "disconnect")
        await page
          .getByRole("button", { name: "Disconnect", exact: true })
          .click();
      if (action === "reconnect") {
        await page.evaluate(() => {
          const socket = (
            window as Window & { __nexusSockets?: WebSocket[] }
          ).__nexusSockets?.find(
            (candidate) =>
              candidate.url.includes("/api/ws") &&
              candidate.readyState === WebSocket.OPEN,
          );
          if (!socket) throw new Error("Missing room websocket");
          socket.close(4005, "Simulated realtime drop");
        });
        await expect(
          page.getByText(/Restoring realtime channel/),
        ).toBeVisible();
      }
      await page.evaluate(() => window.__nexusCamera.resolve?.());
      await expect
        .poll(() =>
          page.evaluate(() => window.__nexusCamera.tracks[0]?.readyState),
        )
        .toBe("ended");
      await expect(page.getByTestId("camera-video")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test("camera stops capture and clears the local tile when signaling drops", async ({
  browser,
}) => {
  const context = await createVoiceContext(browser, [
    installCameraHarness,
    installWebSocketTracker,
  ]);
  const page = await context.newPage();
  try {
    await login(page, "Alice");
    await page
      .getByRole("button", { name: "Turn camera on", exact: true })
      .click();
    await expectCameraPlaying(page, "Alice (YOU)");
    await page.evaluate(() => {
      const socket = (
        window as Window & { __nexusSockets?: WebSocket[] }
      ).__nexusSockets?.find(
        (candidate) =>
          candidate.url.includes("/api/ws") &&
          candidate.readyState === WebSocket.OPEN,
      );
      if (!socket) throw new Error("Missing room websocket");
      socket.close(4005, "Simulated realtime drop");
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.__nexusCamera.tracks[0]?.readyState),
      )
      .toBe("ended");
    await expect(page.getByTestId("camera-video")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Turn camera on", exact: true }),
    ).toBeEnabled();
    expect(await page.evaluate(() => window.__nexusCamera.requests)).toBe(1);
  } finally {
    await context.close();
  }
});

test("camera coexists with screen sharing and stops when the device ends capture", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installCameraHarness,
    installScreenShareMocks,
  ]);
  const bobContext = await createVoiceContext(browser, [
    installCameraHarness,
    installScreenShareMocks,
  ]);
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  try {
    await login(alice, "Alice");
    await login(bob, "Bob");
    await alice
      .getByRole("button", { name: "Turn camera on", exact: true })
      .click();
    await expectCameraPlaying(bob, "Alice");
    await clickScreenShare(alice);
    await expectScreenStageVideo(bob, "Alice");
    await expectCameraPlaying(bob, "Alice");
    await alice.evaluate(() => {
      const track = window.__nexusCamera.tracks[0]!;
      track.stop();
      track.dispatchEvent(new Event("ended"));
    });
    await expect(bob.getByLabel("Alice camera", { exact: true })).toHaveCount(
      0,
    );
    await expectScreenStageVideo(bob, "Alice");
    await expectRemoteAudioPlaying(bob);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("whiteboard syncs pen, colors, eraser and undo-own-stroke between participants", async ({
  browser,
}) => {
  const contexts = await Promise.all([
    createVoiceContext(browser),
    createVoiceContext(browser),
  ]);
  try {
    const alice = await contexts[0]!.newPage();
    const bob = await contexts[1]!.newPage();
    await login(alice, "Alice");
    await login(bob, "Bob");
    await openWhiteboard(alice);
    await openWhiteboard(bob);
    await drawBoardLine(alice, [0.1, 0.5], [0.9, 0.5]);
    await expect
      .poll(() => boardPixel(bob, 0.5, 0.5))
      .toEqual([0, 255, 65, 255]);
    await bob.getByRole("button", { name: "Cyan pen", exact: true }).click();
    await drawBoardLine(bob, [0.5, 0.2], [0.5, 0.8]);
    await expect
      .poll(() => boardPixel(alice, 0.5, 0.5))
      .toEqual([34, 211, 238, 255]);
    await bob
      .getByRole("button", { name: "Undo my last stroke", exact: true })
      .click();
    await expect
      .poll(() => boardPixel(alice, 0.5, 0.5))
      .toEqual([0, 255, 65, 255]);
    await expect(
      bob.getByRole("button", { name: "Undo my last stroke", exact: true }),
    ).toBeDisabled();
    await bob.getByRole("button", { name: "Use eraser", exact: true }).click();
    await drawBoardLine(bob, [0.5, 0.2], [0.5, 0.8]);
    await expect
      .poll(async () => (await boardPixel(alice, 0.5, 0.5))[3])
      .toBe(0);
    await bob
      .getByRole("button", { name: "Undo my last stroke", exact: true })
      .click();
    await expect
      .poll(() => boardPixel(bob, 0.5, 0.5))
      .toEqual([0, 255, 65, 255]);
    await expectRemoteAudioPlaying(alice);
    await expectRemoteAudioPlaying(bob);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("whiteboard sends bounded point batches and renders history for a late joiner", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installWhiteboardTracker,
  ]);
  const bobContext = await createVoiceContext(browser, [
    installWhiteboardTracker,
  ]);
  try {
    const alice = await aliceContext.newPage();
    await login(alice, "Alice");
    await openWhiteboard(alice);
    await drawBoardLine(alice, [0.1, 0.5], [0.9, 0.5], 40);
    await expect(alice.getByText("1 stroke", { exact: true })).toBeVisible();
    const sent = await alice.evaluate(() => window.__nexusBoard.sent);
    const batches = sent.filter(
      (entry) => entry.message.command.type === "append",
    );
    expect(sent.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThan(
      6000,
    );
    expect(
      batches.every((entry) => entry.message.command.points.length <= 32),
    ).toBe(true);
    const intermediate = batches.filter((entry) => !entry.message.command.done);
    for (let i = 1; i < intermediate.length; i++)
      expect(
        intermediate[i]!.time - intermediate[i - 1]!.time,
      ).toBeGreaterThanOrEqual(35);
    const bob = await bobContext.newPage();
    await login(bob, "Bob");
    expect(await bob.evaluate(() => window.__nexusBoard.snapshot)).toBeNull();
    expect(await bob.evaluate(() => window.__nexusBoard.updates.length)).toBe(
      0,
    );
    await openWhiteboard(bob);
    await expect
      .poll(() => boardPixel(bob, 0.5, 0.5))
      .toEqual([0, 255, 65, 255]);
    await bob.getByTestId("room-control-whiteboard").click();
    const updatesWhileClosing = await bob.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return window.__nexusBoard.updates.length;
    });
    await drawBoardLine(alice, [0.1, 0.7], [0.9, 0.7]);
    await expect(alice.getByText("2 strokes", { exact: true })).toBeVisible();
    expect(await bob.evaluate(() => window.__nexusBoard.updates.length)).toBe(
      updatesWhileClosing,
    );
    await openWhiteboard(bob);
    await expect
      .poll(() => boardPixel(bob, 0.5, 0.5))
      .toEqual([0, 255, 65, 255]);
    await expect(bob.getByText("2 strokes", { exact: true })).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("whiteboard UI code is downloaded only when opened", async ({
  browser,
}) => {
  const context = await createVoiceContext(browser);
  try {
    const page = await context.newPage();
    const scripts: string[] = [];
    page.on("response", async (response) => {
      if (new URL(response.url()).pathname.endsWith(".js"))
        scripts.push(await response.text());
    });
    await login(page, "Alice");
    expect(scripts.some((source) => source.includes("Shared whiteboard"))).toBe(
      false,
    );
    await openWhiteboard(page);
    await expect
      .poll(() =>
        scripts.some((source) => source.includes("Shared whiteboard")),
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});

test("whiteboard download failure leaves voice controls and audio running", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser);
  const bobContext = await createVoiceContext(browser);
  try {
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    await alice.route("**/*.js", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      if (source.includes("Shared whiteboard")) await route.abort();
      else await route.fulfill({ response });
    });
    await login(alice, "Alice");
    await login(bob, "Bob");
    await expectRemoteAudioPlaying(alice);
    await alice
      .getByRole("button", { name: "Open whiteboard", exact: true })
      .click();
    await expect(alice.getByRole("alert")).toContainText(
      "The whiteboard could not load",
    );
    await alice
      .getByRole("button", { name: "Close whiteboard", exact: true })
      .click();
    await alice
      .getByRole("button", { name: "Mute microphone", exact: true })
      .click();
    await expect(
      alice.getByRole("button", { name: "Unmute microphone", exact: true }),
    ).toBeVisible();
    await expectRemoteAudioPlaying(alice);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("whiteboard clear is shared and an empty room starts with a clean board", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser);
  const bobContext = await createVoiceContext(browser);
  const carolContext = await createVoiceContext(browser);
  try {
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    await login(alice, "Alice");
    await login(bob, "Bob");
    await openWhiteboard(alice);
    await openWhiteboard(bob);
    await drawBoardLine(alice, [0.1, 0.5], [0.9, 0.5]);
    await expect
      .poll(() => boardPixel(bob, 0.5, 0.5))
      .toEqual([0, 255, 65, 255]);
    await bob.getByRole("button", { name: "Clear board", exact: true }).click();
    await bob.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await boardPixel(alice, 0.5, 0.5))[3]).toBe(255);
    await bob.getByRole("button", { name: "Clear board", exact: true }).click();
    await bob
      .getByRole("button", { name: "Confirm clear whiteboard", exact: true })
      .click();
    await expect
      .poll(async () => (await boardPixel(alice, 0.5, 0.5))[3])
      .toBe(0);
    await expect(bob.getByText("0 strokes", { exact: true })).toBeVisible();
    await drawBoardLine(alice, [0.1, 0.5], [0.9, 0.5]);
    await expect
      .poll(() => boardPixel(bob, 0.5, 0.5))
      .toEqual([0, 255, 65, 255]);
    await alice
      .getByRole("button", { name: "Disconnect", exact: true })
      .click();
    await bob.getByRole("button", { name: "Disconnect", exact: true }).click();
    const carol = await carolContext.newPage();
    await login(carol, "Carol");
    await openWhiteboard(carol);
    await expect(carol.getByText("0 strokes", { exact: true })).toBeVisible();
    expect((await boardPixel(carol, 0.5, 0.5))[3]).toBe(0);
  } finally {
    await Promise.all([
      aliceContext.close(),
      bobContext.close(),
      carolContext.close(),
    ]);
  }
});

test("whiteboard restores a room snapshot after reconnect and rejects drawing while AFK", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installWebSocketTracker,
    installWhiteboardTracker,
  ]);
  const bobContext = await createVoiceContext(browser);
  try {
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    await login(alice, "Alice");
    await login(bob, "Bob");
    await openWhiteboard(alice);
    await openWhiteboard(bob);
    await drawBoardLine(alice, [0.1, 0.5], [0.9, 0.5]);
    await expect
      .poll(() => boardPixel(bob, 0.5, 0.5))
      .toEqual([0, 255, 65, 255]);
    await alice.evaluate(() => {
      const sockets = (window as Window & { __nexusSockets?: WebSocket[] })
        .__nexusSockets!;
      sockets
        .find(
          (socket) =>
            socket.url.includes("/api/ws") &&
            socket.readyState === WebSocket.OPEN,
        )!
        .close(4005, "Simulated drop");
    });
    await expect(alice.getByText(/realtime connection lost/i)).toBeVisible();
    await expect(
      alice.getByRole("button", { name: "Use pen", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(() => boardPixel(alice, 0.5, 0.5))
      .toEqual([0, 255, 65, 255]);
    await alice.getByRole("button", { name: "Go AFK", exact: true }).click();
    await expect(
      alice.getByRole("button", { name: "Use pen", exact: true }),
    ).toBeDisabled();
    await alice.evaluate(() => {
      const sockets = (window as Window & { __nexusSockets?: WebSocket[] })
        .__nexusSockets!;
      const socket = sockets.find(
        (candidate) =>
          candidate.url.includes("/api/ws") &&
          candidate.readyState === WebSocket.OPEN,
      )!;
      socket.send(
        JSON.stringify({
          type: "whiteboard:command",
          command: {
            type: "clear",
            epoch: window.__nexusBoard.snapshot!.epoch,
          },
        }),
      );
    });
    await expect(
      alice.getByText("Return from AFK to draw on the whiteboard.", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await boardPixel(bob, 0.5, 0.5))[3]).toBe(255);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("whiteboard accepts touch input with the same coordinates as desktop viewers", async ({
  browser,
}) => {
  const context = await browser.newContext({
    permissions: ["microphone"],
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await login(page, "Touch");
    await openWhiteboard(page);
    const rect = await page
      .getByLabel("Collaborative whiteboard", { exact: true })
      .boundingBox();
    if (!rect) throw new Error("Missing board");
    await page.touchscreen.tap(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    await expect
      .poll(async () => (await boardPixel(page, 0.5, 0.5))[3])
      .toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("screen share expands with the viewport and enters and exits fullscreen without recapturing", async ({
  browser,
}) => {
  const context = await createVoiceContext(browser, [installScreenShareMocks]);
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await login(page, "Alice");
    await clickScreenShare(page);
    await expectScreenStageVideo(page, "Alice");
    const stage = await page.getByTestId("screen-stage").boundingBox();
    const video = await page.getByTestId("screen-share-video").boundingBox();
    expect(stage!.width).toBeGreaterThan(1400);
    expect(video!.height).toBeGreaterThan(700);
    await page
      .getByRole("button", {
        name: "Enter screen share fullscreen",
        exact: true,
      })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.fullscreenElement?.getAttribute("data-testid"),
        ),
      )
      .toBe("screen-stage");
    await page
      .getByRole("button", {
        name: "Exit screen share fullscreen",
        exact: true,
      })
      .click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === null))
      .toBe(true);
    await expectLocalScreenTrackState(page, "live");
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __nexusScreenShare?: { starts: number } })
            .__nexusScreenShare?.starts,
      ),
    ).toBe(1);
  } finally {
    await context.close();
  }
});

test("screen share remains usable when fullscreen is refused", async ({
  browser,
}) => {
  const context = await createVoiceContext(browser, [
    installScreenShareMocks,
    () => {
      Element.prototype.requestFullscreen = () =>
        Promise.reject(new DOMException("Blocked", "NotAllowedError"));
    },
  ]);
  try {
    const page = await context.newPage();
    await login(page, "Alice");
    await clickScreenShare(page);
    await page
      .getByRole("button", {
        name: "Enter screen share fullscreen",
        exact: true,
      })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Fullscreen is unavailable",
    );
    await expectScreenStageVideo(page, "Alice");
    await expectLocalScreenTrackState(page, "live");
  } finally {
    await context.close();
  }
});

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

test("notification sounds cover join and leave for local and remote clients", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installNotificationSoundTracker,
  ]);
  const bobContext = await createVoiceContext(browser, [
    installNotificationSoundTracker,
  ]);

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await expectRoomPresence(alicePage, 1, ["Alice (YOU)"]);
  await expectNotificationSoundLog(alicePage, ["join"]);

  await login(bobPage, "Bob");
  await expectRoomPresence(alicePage, 2, ["Alice (YOU)", "Bob"]);
  await expectRoomPresence(bobPage, 2, ["Bob (YOU)", "Alice"]);
  await expectNotificationSoundLog(alicePage, ["join", "join"]);
  await expectNotificationSoundLog(bobPage, ["join"]);

  await bobPage.getByRole("button", { name: /disconnect/i }).click();
  await expectRoomPresence(alicePage, 1, ["Alice (YOU)"]);
  await expectNotificationSoundLog(alicePage, ["join", "join", "leave"]);
  await expectNotificationSoundLog(bobPage, ["join", "leave"]);

  await aliceContext.close();
  await bobContext.close();
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

test("opens audio settings and restores persisted device selections after reload", async ({
  browser,
}) => {
  const context = await createVoiceContext(browser, [
    installAudioDeviceMocks,
    installMicrophoneCaptureTracker,
  ]);
  const page = await context.newPage();

  await login(page, "Alice");
  await openAudioSettings(page);

  await page
    .getByTestId("audio-settings-microphone-select")
    .selectOption("mic-beta");
  await page
    .getByTestId("audio-settings-speaker-select")
    .selectOption("speaker-beta");
  await expectAudioSettingsSelections(page, {
    microphoneId: "mic-beta",
    speakerId: "speaker-beta",
  });
  await expect.poll(() => getRequestedMicrophoneDeviceIds(page)).toEqual([
    "",
    "mic-beta",
  ]);

  await page.reload();
  await expect(page.getByTestId("audio-settings-trigger")).toBeVisible();
  await openAudioSettings(page);
  await expectAudioSettingsSelections(page, {
    microphoneId: "mic-beta",
    speakerId: "speaker-beta",
  });

  await context.close();
});

test("routes remote playback to the selected speaker sink when supported", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [installAudioDeviceMocks]);
  const bobContext = await createVoiceContext(browser, [installAudioDeviceMocks]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");
  await expectRemoteAudioPlaying(alicePage);

  await openAudioSettings(alicePage);
  await alicePage
    .getByTestId("audio-settings-speaker-select")
    .selectOption("speaker-beta");
  await expectAudioSettingsSelections(alicePage, {
    microphoneId: "",
    speakerId: "speaker-beta",
  });
  await expectRemoteAudioSinkId(alicePage, "speaker-beta");

  await aliceContext.close();
  await bobContext.close();
});

test("shows fallback speaker copy when output routing is unsupported", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installAudioDeviceMocksWithoutSpeakerSelection,
  ]);
  const bobContext = await createVoiceContext(browser, [installAudioDeviceMocks]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");
  await expectRemoteAudioPlaying(alicePage);
  await openAudioSettings(alicePage);

  await expect(
    alicePage.getByTestId("audio-settings-microphone-select"),
  ).toBeEnabled();
  await expect(alicePage.getByTestId("audio-settings-speaker-select")).toBeEnabled();
  await alicePage
    .getByTestId("audio-settings-speaker-select")
    .selectOption("speaker-beta");
  await expect(alicePage.getByTestId("audio-settings-speaker-select")).toHaveValue("");
  await expect(
    alicePage.getByText(/speaker selection is available in supported chromium-based browsers\./i),
  ).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});

test("switches microphones without disconnecting the room", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installAudioDeviceMocks,
    installMicrophoneCaptureTracker,
  ]);
  const bobContext = await createVoiceContext(browser, [installAudioDeviceMocks]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");
  await expectRoomPresence(alicePage, 2, ["Alice (YOU)", "Bob"]);
  await expectRemoteAudioPlaying(alicePage);

  await openAudioSettings(alicePage);
  await alicePage
    .getByTestId("audio-settings-microphone-select")
    .selectOption("mic-beta");

  await expect.poll(() => getRequestedMicrophoneDeviceIds(alicePage)).toEqual([
    "",
    "mic-beta",
  ]);
  await expectRoomPresence(alicePage, 2, ["Alice (YOU)", "Bob"]);
  await expect(alicePage.getByText(/realtime connection lost\. reconnecting/i)).toHaveCount(0);
  await expectRemoteAudioPlaying(alicePage);

  await aliceContext.close();
  await bobContext.close();
});

test("mute and AFK release microphone capture until resumed", async ({
  browser,
}) => {
  const context = await createVoiceContext(browser, [
    installMicrophoneCaptureTracker,
  ]);
  const page = await context.newPage();

  await login(page, "Alice");
  await expectMicrophoneCaptureState(page, {
    requestCount: 1,
    liveTrackCount: 1,
    endedTrackCount: 0,
  });

  await page.getByRole("button", { name: /mute microphone/i }).click();
  await expect(
    page.getByRole("button", { name: /unmute microphone/i }),
  ).toBeVisible();
  await expectMicrophoneCaptureState(page, {
    requestCount: 1,
    liveTrackCount: 0,
    endedTrackCount: 1,
  });

  await page.getByRole("button", { name: /unmute microphone/i }).click();
  await expectMicrophoneCaptureState(page, {
    requestCount: 2,
    liveTrackCount: 1,
    endedTrackCount: 1,
  });

  await clickAfk(page);
  await expect(page.getByText(/AFK: mic and room audio paused\./i)).toBeVisible();
  await expectMicrophoneCaptureState(page, {
    requestCount: 2,
    liveTrackCount: 0,
    endedTrackCount: 2,
  });

  await clickAfk(page);
  await expect(page.getByText(/AFK: mic and room audio paused\./i)).toHaveCount(0);
  await expectMicrophoneCaptureState(page, {
    requestCount: 3,
    liveTrackCount: 1,
    endedTrackCount: 2,
  });

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

test("notification sounds stay local for mute and unmute", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installNotificationSoundTracker,
  ]);
  const bobContext = await createVoiceContext(browser, [
    installNotificationSoundTracker,
  ]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");
  await expectRoomPresence(alicePage, 2, ["Alice (YOU)", "Bob"]);
  await expectRoomPresence(bobPage, 2, ["Bob (YOU)", "Alice"]);
  await expectNotificationSoundLog(alicePage, ["join", "join"]);
  await expectNotificationSoundLog(bobPage, ["join"]);
  await clearNotificationSoundLog(alicePage);
  await clearNotificationSoundLog(bobPage);

  await alicePage.getByRole("button", { name: /mute microphone/i }).click();
  await expectNotificationSoundLog(alicePage, ["mute"]);
  await expectNotificationSoundLog(bobPage, []);

  await alicePage.getByRole("button", { name: /unmute microphone/i }).click();
  await expectNotificationSoundLog(alicePage, ["mute", "unmute"]);
  await expectNotificationSoundLog(bobPage, []);

  await aliceContext.close();
  await bobContext.close();
});

test("notification sounds cover AFK and return for local and remote clients", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installNotificationSoundTracker,
  ]);
  const bobContext = await createVoiceContext(browser, [
    installNotificationSoundTracker,
  ]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");
  await expectRoomPresence(alicePage, 2, ["Alice (YOU)", "Bob"]);
  await expectRoomPresence(bobPage, 2, ["Bob (YOU)", "Alice"]);
  await expectNotificationSoundLog(alicePage, ["join", "join"]);
  await expectNotificationSoundLog(bobPage, ["join"]);
  await clearNotificationSoundLog(alicePage);
  await clearNotificationSoundLog(bobPage);

  await clickAfk(alicePage);
  await expectNotificationSoundLog(alicePage, ["afk"]);
  await expectNotificationSoundLog(bobPage, ["afk"]);

  await clickAfk(alicePage);
  await expectNotificationSoundLog(alicePage, ["afk", "afk-return"]);
  await expectNotificationSoundLog(bobPage, ["afk", "afk-return"]);

  await alicePage.getByRole("button", { name: "Mute microphone", exact: true }).click();
  await expectNotificationSoundLog(alicePage, ["afk", "afk-return", "mute"]);
  await expectNotificationSoundLog(bobPage, ["afk", "afk-return"]);

  await aliceContext.close();
  await bobContext.close();
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

test("notification sounds cover screen share start, stop, takeover, and late joins", async ({
  browser,
}) => {
  const aliceContext = await createVoiceContext(browser, [
    installScreenShareMocks,
    installNotificationSoundTracker,
  ]);
  const bobContext = await createVoiceContext(browser, [
    installScreenShareMocks,
    installNotificationSoundTracker,
  ]);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await login(alicePage, "Alice");
  await login(bobPage, "Bob");
  await expectRoomPresence(alicePage, 2, ["Alice (YOU)", "Bob"]);
  await expectRoomPresence(bobPage, 2, ["Bob (YOU)", "Alice"]);
  await expectNotificationSoundLog(alicePage, ["join", "join"]);
  await expectNotificationSoundLog(bobPage, ["join"]);
  await clearNotificationSoundLog(alicePage);
  await clearNotificationSoundLog(bobPage);

  await clickScreenShare(alicePage);
  await expectNotificationSoundLog(alicePage, ["screen-share-start"]);
  await expectNotificationSoundLog(bobPage, ["screen-share-start"]);

  await clickStopScreenShare(alicePage);
  await expectNotificationSoundLog(alicePage, [
    "screen-share-start",
    "screen-share-stop",
  ]);
  await expectNotificationSoundLog(bobPage, [
    "screen-share-start",
    "screen-share-stop",
  ]);

  await clearNotificationSoundLog(alicePage);
  await clearNotificationSoundLog(bobPage);

  await clickScreenShare(alicePage);
  await expectNotificationSoundLog(alicePage, ["screen-share-start"]);
  await expectNotificationSoundLog(bobPage, ["screen-share-start"]);

  await clickScreenShare(bobPage);
  await expectScreenStageVideo(alicePage, "Bob");
  await expectScreenStageVideo(bobPage, "Bob");
  await expectNotificationSoundLog(alicePage, [
    "screen-share-start",
    "screen-share-stop",
  ]);
  await expectNotificationSoundLog(bobPage, [
    "screen-share-start",
    "screen-share-stop",
  ]);

  const carolContext = await createVoiceContext(browser, [
    installScreenShareMocks,
    installNotificationSoundTracker,
  ]);
  const carolPage = await carolContext.newPage();

  await login(carolPage, "Carol");
  await expectScreenStageVideo(carolPage, "Bob");
  await expectNotificationSoundLog(carolPage, ["join"]);

  await aliceContext.close();
  await bobContext.close();
  await carolContext.close();
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
