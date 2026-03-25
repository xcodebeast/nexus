/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { createRoot } from "react-dom/client";
import { App } from "./App";
import { appConfig } from "./lib/config";
import { isLocalhostHost, isPwaLocalOptIn } from "./lib/pwa";

function ensureHeadTag<T extends Element>(
  selector: string,
  create: () => T,
) {
  const existingTag = document.head.querySelector<T>(selector);
  if (existingTag) {
    return existingTag;
  }

  const nextTag = create();
  document.head.append(nextTag);
  return nextTag;
}

function syncPwaDocumentMetadata() {
  const manifestLink = ensureHeadTag<HTMLLinkElement>(
    'link[rel="manifest"]',
    () => {
      const link = document.createElement("link");
      link.rel = "manifest";
      return link;
    },
  );
  manifestLink.href = "/manifest.webmanifest";

  const faviconLink = ensureHeadTag<HTMLLinkElement>(
    'link[rel="icon"]',
    () => {
      const link = document.createElement("link");
      link.rel = "icon";
      return link;
    },
  );
  faviconLink.href = "/favicon.ico";

  const appleTouchIconLink = ensureHeadTag<HTMLLinkElement>(
    'link[rel="apple-touch-icon"]',
    () => {
      const link = document.createElement("link");
      link.rel = "apple-touch-icon";
      return link;
    },
  );
  appleTouchIconLink.href = "/apple-touch-icon.png";

  const themeColorMeta = ensureHeadTag<HTMLMetaElement>(
    'meta[name="theme-color"]',
    () => {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      return meta;
    },
  );
  themeColorMeta.content = appConfig.pwa.themeColor;
}

async function unregisterDevelopmentServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();

  await Promise.all(
    registrations.map(async (registration) => {
      const worker =
        registration.installing ?? registration.waiting ?? registration.active;
      const scriptUrl = worker?.scriptURL ?? "";

      if (!scriptUrl.includes("/sw.js")) {
        return;
      }

      await registration.unregister();
    }),
  );

  if (!("caches" in window)) {
    return;
  }

  const cacheKeys = await window.caches.keys();
  await Promise.all(
    cacheKeys
      .filter((cacheKey) => cacheKey.startsWith("nexus-shell-"))
      .map((cacheKey) => window.caches.delete(cacheKey)),
  );
}

async function setupPwaSupport() {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  const isLocalhost = isLocalhostHost(window.location.hostname);
  const isPwaOptIn = isPwaLocalOptIn(window.location.search);

  if (isLocalhost && !isPwaOptIn) {
    await unregisterDevelopmentServiceWorkers();
    return;
  }

  if (!window.isSecureContext) {
    return;
  }

  try {
    await navigator.serviceWorker.register(
      `/sw.js?v=${encodeURIComponent(appConfig.pwa.cacheVersion)}`,
      {
        scope: "/",
      },
    );
  } catch (cause) {
    console.warn(
      `Failed to register the Nexus service worker (${cause instanceof Error ? cause.message : "unknown"}).`,
    );
  }
}

function start() {
  syncPwaDocumentMetadata();
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
  void setupPwaSupport();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
