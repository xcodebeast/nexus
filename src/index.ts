import { serve, type ServerWebSocket } from "bun";
import index from "./index.html";
import type {
  ClientEvent,
  ErrorPayload,
  IceServerConfig,
  LoginRequest,
  RoomUser,
  ServerEvent,
  SessionPayload,
} from "./lib/protocol";

const SESSION_COOKIE_NAME = "nexus_session";
const ROOM_ID = process.env.NEXUS_ROOM_ID ?? "main";
const ROOM_TOPIC = `room:${ROOM_ID}`;
const DEFAULT_PASSWORD = process.env.NEXUS_PASSWORD ?? "nexus";
const CONFIGURED_PASSWORD_HASH = process.env.NEXUS_PASSWORD_HASH?.trim();
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOSTNAME = process.env.HOST ?? "0.0.0.0";

interface SessionRecord {
  id: string;
  username: string;
  createdAt: number;
}

interface ParticipantRecord extends RoomUser {}

interface SocketData {
  sessionId: string;
}

const sessions = new Map<string, SessionRecord>();
const participants = new Map<string, ParticipantRecord>();
const sockets = new Map<string, ServerWebSocket<SocketData>>();
const rtcConfiguration = buildRtcConfiguration();
const verifyPassword = await buildPasswordVerifier();

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

function buildRtcConfiguration() {
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

  return {
    iceServers,
    iceCandidatePoolSize: 10,
  };
}

function json<T>(payload: T, init: ResponseInit = {}) {
  return Response.json(payload, init);
}

function errorResponse(status: number, message: string) {
  return json<ErrorPayload>({ message }, { status });
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
    rtcConfiguration,
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

  const session: SessionRecord = {
    id: crypto.randomUUID(),
    username,
    createdAt: Date.now(),
  };

  sessions.set(session.id, session);

  return json(toSessionPayload(session), {
    headers: {
      "Set-Cookie": serializeSessionCookie(session.id),
    },
  });
}

function handleGetSession(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return errorResponse(401, "No active session.");
  }

  return json(toSessionPayload(session));
}

function handleDeleteSession(request: Request) {
  const session = getSessionFromRequest(request);
  if (session) {
    destroySession(session.id, 4001, "Disconnected");
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": clearSessionCookie(),
    },
  });
}

function handleWebSocketUpgrade(request: Request, server: Bun.Server<SocketData>) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return errorResponse(401, "No active session.");
  }

  const existingSocket = sockets.get(session.id);
  if (existingSocket) {
    existingSocket.close(4002, "Duplicate connection");
  }

  const upgraded = server.upgrade(request, {
    data: {
      sessionId: session.id,
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
    "/api/health": () => new Response("ok"),
    "/api/session": {
      GET: handleGetSession,
      POST: handleCreateSession,
      DELETE: handleDeleteSession,
    },
    "/api/ws": handleWebSocketUpgrade,
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
          rtcConfiguration,
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
          isMuted: event.isMuted,
          isSpeaking: event.isMuted ? false : event.isSpeaking,
        };

        participants.set(session.id, nextParticipant);
        broadcast({
          type: "room:user-updated",
          user: nextParticipant,
        });
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
