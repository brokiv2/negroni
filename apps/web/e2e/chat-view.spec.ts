import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("assistant view keeps one conversation and returns to team view", async ({
  page,
}, testInfo) => {
  await signup(page, `chat-view-${Date.now()}@rakazo.test`, "password12", "Chat View QA");
  await completeOnboarding(page);

  const rootThread = new URL(page.url()).pathname;
  const sidebar = page.locator(".rk-sidebar");
  const workspace = page.getByRole("navigation", { name: "Workspace" });
  await expect(sidebar).toBeVisible();

  await workspace.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${rootThread}$`));
  await expect(sidebar).toBeHidden();
  await expect(workspace.getByRole("button", { name: "Chat", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const composer = page.getByRole("combobox", { name: /Message Chief/ });
  await composer.fill("**Formatted reply**");
  await composer.press("Enter");
  const formattedMessage = page
    .getByTestId("transcript")
    .locator("strong")
    .filter({ hasText: "Formatted reply" })
    .first();
  await expect(formattedMessage).toBeVisible();
  await captureScreenshot(page, testInfo, "assistant-view");

  await page.reload();
  await expect(sidebar).toBeHidden();
  await expect(formattedMessage).toBeVisible();
  await workspace.getByRole("button", { name: "Team", exact: true }).click();
  await expect(sidebar).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Team", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.reload();
  await expect(workspace.getByRole("button", { name: "Team", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sidebar).toBeVisible();
  await captureScreenshot(page, testInfo, "team-view");
});
