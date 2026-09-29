import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("opens the assistant conversation and keeps Team optional", async ({ page }, testInfo) => {
  await signup(page, `assistant-${Date.now()}@rakazo.test`, "password12", "Assistant fixture");
  await completeOnboarding(page);
  const tabs = page.getByRole("navigation", { name: "Workspace" });
  await expect(tabs.getByRole("button", { name: "Chat", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("combobox", { name: "Message Chief" })).toBeVisible();
  await captureScreenshot(page, testInfo, "assistant-conversation-default");
  await tabs.getByRole("button", { name: "Team", exact: true }).click();
  await expect(tabs.getByRole("button", { name: "Team", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await tabs.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Message Chief" })).toBeVisible();
});
