import { expect, test } from "@playwright/test";

test("loads the app and opens the login dialog", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "NEXUS" })).toBeVisible();

  const connectButton = page.getByRole("button", { name: /> Connect/i });
  await expect(connectButton).toBeVisible({ timeout: 7_000 });
  await connectButton.click();

  await expect(page.getByRole("heading", { name: /> ACCESS TERMINAL/i })).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});
