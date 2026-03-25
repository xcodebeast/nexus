import { serve, type ServerWebSocket } from "bun";
import index from "./index.html";
import { appConfig } from "./lib/config";
import { pwaManifestIcons, pwaShellUrls } from "./lib/pwa";
import type {
  ClientEvent,
  ErrorPayload,
  IceServerConfig,
  LoginRequest,
  RtcConfigurationPayload,
  RoomUser,
  ServerEvent,
  SessionPayload,
  WebRtcSignal,
} from "./lib/protocol";

const SESSION_COOKIE_NAME = "nexus_session";
const ROOM_ID = process.env.NEXUS_ROOM_ID ?? "main";
const ROOM_TOPIC = `room:${ROOM_ID}`;
const DEFAULT_PASSWORD = process.env.NEXUS_PASSWORD ?? "nexus";
const CONFIGURED_PASSWORD_HASH = process.env.NEXUS_PASSWORD_HASH?.trim();
const CLOUDFLARE_TURN_KEY_ID = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
const CLOUDFLARE_TURN_API_TOKEN =
  process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
const CLOUDFLARE_TURN_TTL_SECONDS = parseCloudflareTurnTtlSeconds();
const CLOUDFLARE_TURN_MOCK_ICE_SERVERS = parseMockIceServers();
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOSTNAME = process.env.HOST ?? "0.0.0.0";
const RTC_CONFIGURATION_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const NO_STORE_CACHE_CONTROL = "no-store";
const REVALIDATE_CACHE_CONTROL = "no-cache, max-age=0, must-revalidate";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const faviconFile = Bun.file(new URL("./assets/favicon.ico", import.meta.url));
const appleTouchIconFile = Bun.file(
  new URL("./assets/pwa/apple-touch-icon.png", import.meta.url),
);
const pwaIcon192File = Bun.file(
  new URL("./assets/pwa/icon-192.png", import.meta.url),
);
const pwaIcon512File = Bun.file(
  new URL("./assets/pwa/icon-512.png", import.meta.url),
);
const pwaIconMaskableFile = Bun.file(
  new URL("./assets/pwa/icon-maskable-512.png", import.meta.url),
);
const serviceWorkerTemplate = await Bun.file(
  new URL("./pwa/sw.js", import.meta.url),
).text();
const serviceWorkerSource = serviceWorkerTemplate
  .replaceAll("__NEXUS_CACHE_VERSION__", appConfig.pwa.cacheVersion)
  .replace("__NEXUS_SHELL_URLS__", JSON.stringify(pwaShellUrls));
const manifestSource = JSON.stringify(
  {
    id: "/",
    name: appConfig.pwa.name,
    short_name: appConfig.pwa.shortName,
    description: appConfig.pwa.description,
    start_url: "/",
    scope: "/",
    display: appConfig.pwa.display,
    background_color: appConfig.pwa.backgroundColor,
    theme_color: appConfig.pwa.themeColor,
    icons: pwaManifestIcons,
  },
  null,
  2,
);

interface SessionRecord {
  id: string;
  username: string;
  createdAt: number;
  rtcConfiguration: RtcConfigurationPayload;
  rtcConfigurationExpiresAt: number | null;
}

interface ParticipantRecord extends RoomUser {}

interface SocketData {
  sessionId: string;
}

const sessions = new Map<string, SessionRecord>();
const participants = new Map<string, ParticipantRecord>();
const sockets = new Map<string, ServerWebSocket<SocketData>>();
let activeScreenShareUserId: string | null = null;
const defaultRtcConfiguration = buildStaticRtcConfiguration();
const verifyPassword = await buildPasswordVerifier();

function hasTurnRelayConfigured(iceServers: IceServerConfig[]) {
  return iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(
      (url) => typeof url === "string" && /^(turn|turns):/i.test(url),
    );
  });
}

async function buildPasswordVerifier() {
  if (CONFIGURED_PASSWORD_HASH) {
    try {
      await Bun.password.verify("__nexus_probe__", CONFIGURED_PASSWORD_HASH);
      return (password: string) =>
        Bun.password.verify(password, CONFIGURED_PASSWORD_HASH);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String(error.code)
          : "unknown";
      console.warn(
        `Invalid NEXUS_PASSWORD_HASH (${code}); falling back to NEXUS_PASSWORD.`,
      );
    }
  }

  return async (password: string) => password === DEFAULT_PASSWORD;
}

function parseCloudflareTurnTtlSeconds() {
  const ttl = Number.parseInt(
    process.env.CLOUDFLARE_TURN_TTL_SECONDS ?? "86400",
    10,
  );

  if (!Number.isFinite(ttl)) {
    return 86400;
  }

  return Math.max(60, Math.min(ttl, 172800));
}

function parseMockIceServers() {
  const payload = process.env.CLOUDFLARE_TURN_MOCK_ICE_SERVERS?.trim();
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as
      | {
          iceServers?: IceServerConfig[];
        }
      | IceServerConfig[];
    const iceServers = Array.isArray(parsed) ? parsed : parsed.iceServers;

    if (!Array.isArray(iceServers)) {
      throw new Error("Missing iceServers array.");
    }

    return iceServers;
  } catch (error) {
    console.warn(
      `Invalid CLOUDFLARE_TURN_MOCK_ICE_SERVERS; ignoring mock (${error instanceof Error ? error.message : "unknown"}).`,
    );
    return null;
  }
}

function buildRtcConfiguration(iceServers: IceServerConfig[]): RtcConfigurationPayload {
  return {
    iceServers,
    iceCandidatePoolSize: 10,
  };
}

function buildStaticRtcConfiguration() {
  const stunUrls = (process.env.NEXUS_STUN_URLS ??
    "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const turnUrls = (process.env.NEXUS_TURN_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const iceServers: IceServerConfig[] = [];

  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls });
  }

  if (
    turnUrls.length > 0 &&
    process.env.NEXUS_TURN_USERNAME &&
    process.env.NEXUS_TURN_CREDENTIAL
  ) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.NEXUS_TURN_USERNAME,
      credential: process.env.NEXUS_TURN_CREDENTIAL,
    });
  }

  return buildRtcConfiguration(iceServers);
}

function hasCloudflareTurnConfigured() {
  return Boolean(CLOUDFLARE_TURN_KEY_ID && CLOUDFLARE_TURN_API_TOKEN);
}

function hasIncompleteCloudflareTurnConfiguration() {
  return Boolean(
    (CLOUDFLARE_TURN_KEY_ID || CLOUDFLARE_TURN_API_TOKEN) &&
      !hasCloudflareTurnConfigured(),
  );
}

async function generateCloudflareRtcConfiguration() {
  const mockIceServers = CLOUDFLARE_TURN_MOCK_ICE_SERVERS;
  if (mockIceServers) {
    return {
      rtcConfiguration: buildRtcConfiguration(mockIceServers),
      expiresAt: Date.now() + CLOUDFLARE_TURN_TTL_SECONDS * 1000,
    };
  }

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_TURN_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ttl: CLOUDFLARE_TURN_TTL_SECONDS,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Cloudflare TURN API returned ${response.status} ${response.statusText}.`,
    );
  }

  const payload = (await response.json()) as {
    iceServers?: IceServerConfig[];
  };

  if (!Array.isArray(payload.iceServers) || payload.iceServers.length === 0) {
    throw new Error("Cloudflare TURN API returned no ice servers.");
  }

  return {
    rtcConfiguration: buildRtcConfiguration(payload.iceServers),
    expiresAt: Date.now() + CLOUDFLARE_TURN_TTL_SECONDS * 1000,
  };
}

async function resolveRtcConfiguration() {
  if (!hasCloudflareTurnConfigured()) {
    return {
      rtcConfiguration: defaultRtcConfiguration,
      expiresAt: null,
    };
  }

  try {
    return await generateCloudflareRtcConfiguration();
  } catch (error) {
    console.warn(
      `Failed to generate Cloudflare TURN credentials; falling back to static RTC configuration (${error instanceof Error ? error.message : "unknown"}).`,
    );
    return {
      rtcConfiguration: defaultRtcConfiguration,
      expiresAt: null,
    };
  }
}

function needsRtcConfigurationRefresh(session: SessionRecord) {
  if (session.rtcConfigurationExpiresAt === null) {
    return false;
  }

  const refreshThreshold = Math.min(
    RTC_CONFIGURATION_REFRESH_BUFFER_MS,
    Math.floor((CLOUDFLARE_TURN_TTL_SECONDS * 1000) / 2),
  );

  return session.rtcConfigurationExpiresAt - Date.now() <= refreshThreshold;
}

async function ensureSessionRtcConfiguration(session: SessionRecord) {
  if (!needsRtcConfigurationRefresh(session)) {
    return session;
  }

  const nextRtcConfiguration = await resolveRtcConfiguration();
  const nextSession: SessionRecord = {
    ...session,
    rtcConfiguration: nextRtcConfiguration.rtcConfiguration,
    rtcConfigurationExpiresAt: nextRtcConfiguration.expiresAt,
  };

  sessions.set(session.id, nextSession);
  return nextSession;
}

if (process.env.NODE_ENV === "production" && hasIncompleteCloudflareTurnConfiguration()) {
  console.warn(
    "Cloudflare TURN is partially configured. Set both CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN or remove them.",
  );
}

if (process.env.NODE_ENV === "production" && hasCloudflareTurnConfigured()) {
  console.info("Cloudflare TURN is enabled via generated ICE credentials.");
} else if (
  process.env.NODE_ENV === "production" &&
  !hasTurnRelayConfigured(defaultRtcConfiguration.iceServers)
) {
  console.warn(
    "TURN relay is not configured. Voice calls can fail between users on different networks. Set Cloudflare TURN credentials or NEXUS_TURN_URLS, NEXUS_TURN_USERNAME, and NEXUS_TURN_CREDENTIAL for production.",
  );
}

function mergeHeaders(
  headersInit: HeadersInit | undefined,
  nextHeaders: Record<string, string>,
) {
  const headers = new Headers(headersInit);

  for (const [key, value] of Object.entries(nextHeaders)) {
    headers.set(key, value);
  }

  return headers;
}

function json<T>(payload: T, init: ResponseInit = {}) {
  return Response.json(payload, {
    ...init,
    headers: mergeHeaders(init.headers, {
      "Cache-Control": NO_STORE_CACHE_CONTROL,
    }),
  });
}

function errorResponse(status: number, message: string) {
  return json<ErrorPayload>({ message }, { status });
}

function fileResponse(
  file: Blob,
  contentType: string,
  cacheControl: string,
  init: ResponseInit = {},
) {
  return new Response(file, {
    ...init,
    headers: mergeHeaders(init.headers, {
      "Cache-Control": cacheControl,
      "Content-Type": contentType,
    }),
  });
}

function manifestResponse() {
  return new Response(manifestSource, {
    headers: {
      "Cache-Control": REVALIDATE_CACHE_CONTROL,
      "Content-Type": "application/manifest+json",
    },
  });
}

function serviceWorkerResponse() {
  return new Response(serviceWorkerSource, {
    headers: {
      "Cache-Control": REVALIDATE_CACHE_CONTROL,
      "Content-Type": "application/javascript; charset=utf-8",
    },
  });
}

function parseCookies(request: Request) {
  const header = request.headers.get("cookie");
  const cookies = new Map<string, string>();

  if (!header) {
    return cookies;
  }

  for (const entry of header.split(";")) {
    const [rawKey, ...rawValue] = entry.trim().split("=");
    if (!rawKey) {
      continue;
    }

    cookies.set(rawKey, decodeURIComponent(rawValue.join("=")));
  }

  return cookies;
}

function getSessionFromRequest(request: Request) {
  const sessionId = parseCookies(request).get(SESSION_COOKIE_NAME);
  return sessionId ? sessions.get(sessionId) ?? null : null;
}

function serializeSessionCookie(sessionId: string) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function toSessionPayload(session: SessionRecord): SessionPayload {
  return {
    user: {
      id: session.id,
      username: session.username,
    },
    roomId: ROOM_ID,
    rtcConfiguration: session.rtcConfiguration,
  };
}

function getSortedUsers() {
  return [...participants.values()].sort(
    (left, right) => left.connectedAt - right.connectedAt,
  );
}

function broadcast(event: ServerEvent) {
  server.publish(ROOM_TOPIC, JSON.stringify(event));
}

function broadcastScreenShareState() {
  broadcast({
    type: "room:screen-share-updated",
    activeScreenShareUserId,
  });
}

function canRelayScreenSignal(
  fromUserId: string,
  targetUserId: string,
  signal: WebRtcSignal,
) {
  if (!activeScreenShareUserId) {
    return false;
  }

  if (fromUserId === activeScreenShareUserId) {
    return targetUserId !== activeScreenShareUserId && signal.type !== "answer";
  }

  return targetUserId === activeScreenShareUserId && signal.type !== "offer";
}

function removeParticipant(
  sessionId: string,
  closingSocket?: ServerWebSocket<SocketData>,
) {
  const activeSocket = sockets.get(sessionId);
  if (closingSocket && activeSocket && activeSocket !== closingSocket) {
    return;
  }

  const participant = participants.get(sessionId);
  if (!activeSocket || activeSocket === closingSocket) {
    sockets.delete(sessionId);
  }

  if (!participant) {
    return;
  }

  if (activeScreenShareUserId === sessionId) {
    activeScreenShareUserId = null;
    broadcastScreenShareState();
  }

  participants.delete(sessionId);
  broadcast({
    type: "room:user-left",
    userId: sessionId,
  });
}

function destroySession(sessionId: string, closeCode?: number, closeReason?: string) {
  const socket = sockets.get(sessionId);
  if (socket) {
    sockets.delete(sessionId);
    socket.close(closeCode, closeReason);
  } else {
    removeParticipant(sessionId);
  }

  sessions.delete(sessionId);
}

async function handleCreateSession(request: Request) {
  let body: LoginRequest;

  try {
    body = (await request.json()) as LoginRequest;
  } catch {
    return errorResponse(400, "Malformed request body.");
  }

  const username = body.username?.trim();
  if (!username || username.length > 24) {
    return errorResponse(400, "Username must be between 1 and 24 characters.");
  }

  const password = body.password ?? "";
  const isValidPassword = await verifyPassword(password);
  if (!isValidPassword) {
    return errorResponse(401, "ACCESS DENIED - Invalid credentials");
  }

  const existingSession = getSessionFromRequest(request);
  if (existingSession) {
    destroySession(existingSession.id, 4000, "Session replaced");
  }

  const nextRtcConfiguration = await resolveRtcConfiguration();

  const session: SessionRecord = {
    id: crypto.randomUUID(),
    username,
    createdAt: Date.now(),
    rtcConfiguration: nextRtcConfiguration.rtcConfiguration,
    rtcConfigurationExpiresAt: nextRtcConfiguration.expiresAt,
  };

  sessions.set(session.id, session);

  return json(toSessionPayload(session), {
    headers: {
      "Set-Cookie": serializeSessionCookie(session.id),
    },
  });
}

async function handleGetSession(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return errorResponse(401, "No active session.");
  }

  const nextSession = await ensureSessionRtcConfiguration(session);
  return json(toSessionPayload(nextSession));
}

function handleDeleteSession(request: Request) {
  const session = getSessionFromRequest(request);
  if (session) {
    destroySession(session.id, 4001, "Disconnected");
  }

  return new Response(null, {
    status: 204,
    headers: mergeHeaders(undefined, {
      "Cache-Control": NO_STORE_CACHE_CONTROL,
      "Set-Cookie": clearSessionCookie(),
    }),
  });
}

async function handleWebSocketUpgrade(
  request: Request,
  server: Bun.Server<SocketData>,
) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return errorResponse(401, "No active session.");
  }

  const nextSession = await ensureSessionRtcConfiguration(session);

  const existingSocket = sockets.get(nextSession.id);
  if (existingSocket) {
    existingSocket.close(4002, "Duplicate connection");
  }

  const upgraded = server.upgrade(request, {
    data: {
      sessionId: nextSession.id,
    },
  });

  if (!upgraded) {
    return errorResponse(400, "WebSocket upgrade failed.");
  }

  return;
}

function safeParseEvent(message: string | Buffer<ArrayBuffer>) {
  if (typeof message !== "string") {
    return null;
  }

  try {
    return JSON.parse(message) as ClientEvent;
  } catch {
    return null;
  }
}

const server = serve<SocketData>({
  port: Number.isFinite(PORT) ? PORT : 3000,
  hostname: HOSTNAME,
  routes: {
    "/api/health": () =>
      new Response("ok", {
        headers: {
          "Cache-Control": NO_STORE_CACHE_CONTROL,
        },
      }),
    "/api/session": {
      GET: handleGetSession,
      POST: handleCreateSession,
      DELETE: handleDeleteSession,
    },
    "/api/ws": handleWebSocketUpgrade,
    "/manifest.webmanifest": manifestResponse,
    "/sw.js": serviceWorkerResponse,
    "/favicon.ico": () =>
      fileResponse(
        faviconFile,
        "image/x-icon",
        IMMUTABLE_CACHE_CONTROL,
      ),
    "/apple-touch-icon.png": () =>
      fileResponse(
        appleTouchIconFile,
        "image/png",
        IMMUTABLE_CACHE_CONTROL,
      ),
    "/pwa/icon-192.png": () =>
      fileResponse(
        pwaIcon192File,
        "image/png",
        IMMUTABLE_CACHE_CONTROL,
      ),
    "/pwa/icon-512.png": () =>
      fileResponse(
        pwaIcon512File,
        "image/png",
        IMMUTABLE_CACHE_CONTROL,
      ),
    "/pwa/icon-maskable-512.png": () =>
      fileResponse(
        pwaIconMaskableFile,
        "image/png",
        IMMUTABLE_CACHE_CONTROL,
      ),
    "/*": index,
  },

  websocket: {
    data: {} as SocketData,
    open(ws) {
      const session = sessions.get(ws.data.sessionId);
      if (!session) {
        ws.close(4003, "Unknown session");
        return;
      }

      const participant: ParticipantRecord = {
        id: session.id,
        username: session.username,
        isAfk: false,
        isMuted: false,
        isSpeaking: false,
        connectedAt: Date.now(),
      };

      participants.set(session.id, participant);
      sockets.set(session.id, ws);
      ws.subscribe(ROOM_TOPIC);
      ws.send(
        JSON.stringify({
          type: "room:snapshot",
          selfUserId: session.id,
          roomId: ROOM_ID,
          users: getSortedUsers(),
          rtcConfiguration: session.rtcConfiguration,
          activeScreenShareUserId,
        } satisfies ServerEvent),
      );
      broadcast({
        type: "room:user-joined",
        user: participant,
      });
    },
    message(ws, message) {
      const event = safeParseEvent(message);
      if (!event) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Malformed realtime payload.",
          } satisfies ServerEvent),
        );
        return;
      }

      const session = sessions.get(ws.data.sessionId);
      const participant = participants.get(ws.data.sessionId);
      if (!session || !participant) {
        ws.close(4004, "Inactive session");
        return;
      }

      if (event.type === "presence:update") {
        const nextParticipant: ParticipantRecord = {
          ...participant,
          isAfk: event.isAfk,
          isMuted: event.isAfk ? true : event.isMuted,
          isSpeaking:
            event.isAfk || event.isMuted ? false : event.isSpeaking,
        };

        participants.set(session.id, nextParticipant);
        broadcast({
          type: "room:user-updated",
          user: nextParticipant,
        });
        if (activeScreenShareUserId === session.id && nextParticipant.isAfk) {
          activeScreenShareUserId = null;
          broadcastScreenShareState();
        }
        return;
      }

      if (event.type === "screen-share:start") {
        if (participant.isAfk) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Return from AFK before sharing your screen.",
            } satisfies ServerEvent),
          );
          return;
        }

        activeScreenShareUserId = session.id;
        broadcastScreenShareState();
        return;
      }

      if (event.type === "screen-share:stop") {
        if (activeScreenShareUserId === session.id) {
          activeScreenShareUserId = null;
          broadcastScreenShareState();
        }
        return;
      }

      if (
        event.channel === "screen" &&
        !canRelayScreenSignal(session.id, event.targetUserId, event.signal)
      ) {
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "Screen sharing signals must be exchanged with the active presenter.",
          } satisfies ServerEvent),
        );
        return;
      }

      const targetParticipant = participants.get(event.targetUserId);
      if (
        event.channel === "audio" &&
        (participant.isAfk || targetParticipant?.isAfk)
      ) {
        return;
      }

      const targetSocket = sockets.get(event.targetUserId);
      if (!targetSocket) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Target user is no longer connected.",
          } satisfies ServerEvent),
        );
        return;
      }

      targetSocket.send(
        JSON.stringify({
          type: "signal",
          channel: event.channel,
          fromUserId: session.id,
          signal: event.signal,
        } satisfies ServerEvent),
      );
    },
    close(ws) {
      removeParticipant(ws.data.sessionId, ws);
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.info(`Nexus server running at ${server.url}`);
