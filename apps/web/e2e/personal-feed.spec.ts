import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("For you keeps publications separate from tasks and gives each article its own conversation", async ({
  page,
}, testInfo) => {
  await signup(page, `feed-${Date.now()}@rakazo.test`, "password12", "Feed reader");
  await completeOnboarding(page);
  const a = await rpc<{ id: string }>(page, "feed/create", {
    kind: "article",
    title: "Ocean research",
    summary: "Research about oceans",
    url: "https://example.com/ocean",
  });
  const b = await rpc<{ id: string }>(page, "feed/create", {
    kind: "link",
    title: "Mountain research",
    summary: "Research about mountains",
    url: "https://example.com/mountains",
  });
  const at = await rpc<{ threadId: string }>(page, "threads/get", { feedItemId: a.id });
  const bt = await rpc<{ threadId: string }>(page, "threads/get", { feedItemId: b.id });
  const main = await rpc<{ threadId: string }>(page, "personal/thread", {});
  expect(new Set([at.threadId, bt.threadId, main.threadId]).size).toBe(3);
  await page.getByRole("button", { name: "For you", exact: true }).click();
  const hub = page.getByRole("region", { name: "For you", exact: true });
  await expect(hub.getByRole("button", { name: "Automations", exact: true })).toBeVisible();
  await expect(hub.getByRole("button", { name: "Goals", exact: true })).toHaveCount(0);
  await hub.getByRole("button", { name: /Ocean research/ }).click();
  await expect(hub.getByRole("heading", { name: "Ocean research", exact: true })).toBeVisible();
  await expect(hub.getByRole("textbox", { name: "Ask about this post" })).toBeVisible();
  await captureScreenshot(page, testInfo, "feed-article-discussion");
  await hub.getByRole("button", { name: "Save", exact: true }).click();
  await hub.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(hub.getByRole("heading", { name: "Ocean research", exact: true })).toBeVisible();
  await expect(hub.getByRole("heading", { name: "Mountain research", exact: true })).toHaveCount(0);
});

test("automation details are collapsed and deletion removes the schedule", async ({ page }, testInfo) => {
  await signup(page, `automation-${Date.now()}@rakazo.test`, "password12", "Feed reader");
  await completeOnboarding(page);
  const main = await rpc<{ botId: string }>(page, "personal/thread", {});
  const routine = await rpc<{ id: string }>(page, "routines/create", {
    botId: main.botId, name: "Research collection", prompt: "Collect selected research topics.",
    crons: ["0 8 * * *"], active: false, notify: false,
  });
  await page.getByRole("button", { name: "For you", exact: true }).click();
  const hub = page.getByRole("region", { name: "For you", exact: true });
  await hub.getByRole("button", { name: "Automations", exact: true }).click();
  await expect(hub.getByText("Collect selected research topics.", {exact:true})).not.toBeVisible();
  await hub.locator("summary", {hasText:"Research collection"}).click();
  await expect(hub.getByText("Collect selected research topics.", {exact:true})).toBeVisible();
  await captureScreenshot(page, testInfo, "automation-details");
  page.once("dialog", dialog => dialog.accept());
  await hub.getByRole("button", {name:"Delete",exact:true}).click();
  await expect(hub.locator("summary",{hasText:"Research collection"})).toHaveCount(0);
  expect((await rpc<{id:string}[]>(page,"routines/list",{botId:main.botId})).some(r=>r.id===routine.id)).toBe(false);
  await hub.getByRole("button",{name:"Customize feed"}).click();
  await expect(hub.getByRole("checkbox",{name:"Learn interests from conversations"})).toBeVisible();
});
