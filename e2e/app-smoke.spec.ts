import { expect, test, type Page } from "@playwright/test";

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

test("authenticates and synchronizes room presence between two clients", async ({
  browser,
}) => {
  const aliceContext = await browser.newContext({
    permissions: ["microphone"],
  });
  const bobContext = await browser.newContext({
    permissions: ["microphone"],
  });

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

  await bobPage.getByRole("button", { name: /disconnect/i }).click();
  await expect(alicePage.getByText(/1 connected/i)).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});
