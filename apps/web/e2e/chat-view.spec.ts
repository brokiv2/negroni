import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("assistant view keeps one conversation and returns to team view", async ({ page }, testInfo) => {
  await signup(page, `chat-view-${Date.now()}@rakazo.test`, "password12", "Chat View QA");
  await completeOnboarding(page);

  const rootThread = new URL(page.url()).pathname;
  const sidebar = page.locator(".rk-sidebar");
  const workspace = page.getByRole("button", { name: "Choose workspace" });
  await expect(sidebar).toBeVisible();

  await workspace.click();
  await page.getByRole("menuitemradio", { name: /Personal assistant/ }).click();
  await expect(page).toHaveURL(new RegExp(`${rootThread}$`));
  await expect(sidebar).toBeHidden();
  await expect(workspace).toContainText("Personal");

  await page.getByRole("button", { name: "Conversation", exact: true }).first().click();
  const composer = page.getByRole("combobox", { name: /Message Chief/ });
  await composer.fill("**Formatted reply**");
  await page.getByRole("button", { name: "Attach file", exact: true }).click();
  await page.getByRole("menuitem", { name: "Preview formatting" }).click();
  await expect(page.locator("strong").filter({ hasText: "Formatted reply" })).toBeVisible();
  await captureScreenshot(page, testInfo, "assistant-view");

  await page.reload();
  await expect(sidebar).toBeHidden();
  await workspace.click();
  await page.getByRole("menuitemradio", { name: /Team chats/ }).click();
  await expect(sidebar).toBeVisible();
  await expect(workspace).toContainText("Team");
  await captureScreenshot(page, testInfo, "team-view");
});
