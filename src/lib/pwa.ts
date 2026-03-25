export const pwaOptInQueryParam = "pwa";
export const pwaOptInQueryValue = "1";

export const offlineConnectMessage =
  "Offline. Nexus can open offline, but joining a voice channel requires a network connection.";

export const offlineRoomMessage =
  "Offline. The room stays visible, and voice and presence reconnect when the network connection returns.";

export const pwaShellUrls = [
  "/",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
  "/pwa/icon-maskable-512.png",
] as const;

export const pwaManifestIcons = [
  {
    src: "/pwa/icon-192.png",
    sizes: "192x192",
    type: "image/png",
  },
  {
    src: "/pwa/icon-512.png",
    sizes: "512x512",
    type: "image/png",
  },
  {
    src: "/pwa/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
] as const;

export function isLocalhostHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function isPwaLocalOptIn(search: string) {
  return new URLSearchParams(search).get(pwaOptInQueryParam) === pwaOptInQueryValue;
}
