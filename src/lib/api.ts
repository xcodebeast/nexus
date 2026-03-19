import type { ErrorPayload, LoginRequest, SessionPayload } from "./protocol";

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as ErrorPayload;
    return payload.message;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as T;
}

export function createSession(payload: LoginRequest) {
  return requestJson<SessionPayload>("/api/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function getSession() {
  const response = await fetch("/api/session", {
    credentials: "same-origin",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as SessionPayload;
}

export async function deleteSession() {
  const response = await fetch("/api/session", {
    method: "DELETE",
    credentials: "same-origin",
  });

  if (!response.ok && response.status !== 401) {
    throw new Error(await readError(response));
  }
}
