import { expect, test, type Page } from "@playwright/test";
import { appConfig } from "../src/lib/config";
import {
  offlineConnectMessage,
  offlineRoomMessage,
  pwaManifestIcons,
} from "../src/lib/pwa";

const pwaPath = "/?skipIntro=1&pwa=1";

async function waitForServiceWorkerReady(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return (
          registration.active?.scriptURL ??
          registration.waiting?.scriptURL ??
          registration.installing?.scriptURL ??
          null
        );
      });
    })
    .toContain(`/sw.js?v=${encodeURIComponent(appConfig.pwa.cacheVersion)}`);
}

async function enablePwaControl(page: Page) {
  await page.goto(pwaPath);
  await waitForServiceWorkerReady(page);
  await page.reload();

  await expect
    .poll(async () => {
      return page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
    })
    .toContain(`/sw.js?v=${encodeURIComponent(appConfig.pwa.cacheVersion)}`);
}

async function login(page: Page, username: string) {
  await page.getByRole("button", { name: /connect/i }).click();
  await expect(
    page.getByRole("heading", { name: /> ACCESS TERMINAL/i }),
  ).toBeVisible();

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("nexus");
  await page.getByRole("button", { name: /authenticate/i }).click();
  await expect(page.getByRole("button", { name: /disconnect/i })).toBeVisible();
}

test("exposes a valid manifest and registers the service worker", async ({
  page,
}) => {
  await enablePwaControl(page);

  const manifestDetails = await page.evaluate(async () => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const manifestHref = manifestLink?.getAttribute("href") ?? null;
    const resolvedManifestUrl = manifestHref
      ? new URL(manifestHref, window.location.href).toString()
      : null;
    const manifest = resolvedManifestUrl
      ? await fetch(resolvedManifestUrl).then((response) => response.json())
      : null;

    return {
      manifestHref,
      manifest,
    };
  });

  expect(manifestDetails.manifestHref).toContain("manifest.webmanifest");
  expect(manifestDetails.manifest).toMatchObject({
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
  });
});

test("reopens the cached shell offline and blocks authentication", async ({
  context,
  page,
}) => {
  await enablePwaControl(page);

  await page.getByRole("button", { name: /connect/i }).click();
  await expect(page.getByTestId("login-offline-notice")).toHaveCount(0);

  await context.setOffline(true);

  await expect(page.getByTestId("login-offline-notice")).toHaveText(
    offlineConnectMessage,
  );
  await expect(page.getByRole("button", { name: /offline/i })).toBeDisabled();

  await page.reload();

  await expect(page.getByTestId("connect-offline-notice")).toHaveText(
    offlineConnectMessage,
  );
  await expect(page.getByRole("button", { name: /connect/i })).toBeDisabled();
});

test("shows explicit offline messaging while reconnecting an active room", async ({
  context,
  page,
}) => {
  await enablePwaControl(page);
  await login(page, "trinity");

  await context.setOffline(true);

  await expect(page.getByTestId("room-offline-notice")).toHaveText(
    offlineRoomMessage,
  );
  await expect(
    page.getByText(/Realtime connection lost\. Reconnecting\.\.\./i),
  ).toBeVisible({ timeout: 15_000 });
});

test("keeps new service workers waiting until the next launch", async ({
  page,
}) => {
  await enablePwaControl(page);

  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js?v=passive-update", {
      scope: "/",
    });
  });

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.waiting?.scriptURL ?? null;
      });
    })
    .toContain("/sw.js?v=passive-update");

  await expect
    .poll(async () => {
      return page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
    })
    .toContain(`/sw.js?v=${encodeURIComponent(appConfig.pwa.cacheVersion)}`);
});
