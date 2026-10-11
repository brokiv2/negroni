import { expect, test } from "@playwright/test";
import type { ThreadSnapshot } from "@rakazo/contracts";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

const fixture = "/e2e/fixtures/response-ui.html";
test("streamed chat reply restores server values and drafts a reply to its source", async ({
  page,
}, info) => {
  test.skip(process.env.AGENT_RUNTIME === "pi", "Deterministic scripted response fixture");
  await signup(page, `response-ui-${Date.now()}@example.test`, "password12", "Response fixture");
  await completeOnboarding(page, undefined, "assistant");
  const composer = page.getByRole("combobox", { name: "Message Chief", exact: true });
  await composer.fill("Show an interactive dinner budget");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const reply = page.getByRole("group", { name: "Dinner budget", exact: true });
  await expect(reply.getByRole("status", { name: "Per person" })).toHaveText("44.00€");
  await reply.getByRole("spinbutton", { name: "Bill", exact: true }).fill("180");
  await reply.getByRole("spinbutton", { name: "People", exact: true }).fill("4");
  await reply.getByRole("textbox", { name: "Note", exact: true }).fill("Sample budget");
  await reply.getByRole("button", { name: "Draft the next step", exact: true }).click();
  await expect(composer).toHaveValue("Help me choose a restaurant within this budget.");
  await expect(page.getByRole("button", { name: "Cancel reply", exact: true })).toBeVisible();
  await expect(reply.getByRole("status", { name: "Per person" })).toHaveText("49.50€");
  await page.reload();
  await expect(reply.getByRole("spinbutton", { name: "Bill", exact: true })).toHaveValue("180");
  await expect(reply.getByRole("spinbutton", { name: "People", exact: true })).toHaveValue("4");
  await expect(reply.getByRole("textbox", { name: "Note", exact: true })).toHaveValue(
    "Sample budget",
  );
  await expect(reply.getByRole("status", { name: "Per person" })).toHaveText("49.50€");
  await captureScreenshot(page, info, "interactive-response-chat");
});
test("interactive chat on a phone keeps controls readable and restores slider calculations", async ({
  page,
}, info) => {
  test.skip(process.env.AGENT_RUNTIME === "pi", "Deterministic scripted response fixture");
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(
    page,
    `response-ui-phone-${Date.now()}@example.test`,
    "password12",
    "Mobile fixture",
  );
  await completeOnboarding(page, undefined, "assistant");
  await page
    .getByRole("combobox", { name: "Message Chief", exact: true })
    .fill("Show an interactive dinner budget");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const reply = page.getByRole("group", { name: "Dinner budget", exact: true });
  const bill = reply.getByRole("spinbutton", { name: "Bill", exact: true });
  const people = reply.getByRole("spinbutton", { name: "People", exact: true });
  const tip = reply.getByRole("slider", { name: "Tip %", exact: false });
  await expect(reply.getByRole("status", { name: "Per person" })).toHaveText("44.00€");
  for (const input of [bill, people, reply.getByRole("textbox", { name: "Note", exact: true })]) {
    const box = await input.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(52);
    expect(box?.width).toBeGreaterThanOrEqual(260);
    expect(
      await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  }
  const billBox = await bill.boundingBox();
  const peopleBox = await people.boundingBox();
  expect(peopleBox!.y).toBeGreaterThanOrEqual(billBox!.y + billBox!.height);
  expect(Math.abs(billBox!.x - peopleBox!.x)).toBeLessThan(1);
  expect((await tip.boundingBox())?.height).toBeGreaterThanOrEqual(56);
  const currency = reply.getByRole("combobox", { name: "Currency", exact: true });
  expect((await currency.boundingBox())?.height).toBeGreaterThanOrEqual(52);
  expect(
    await currency.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  expect(
    (await reply.getByRole("button", { name: "Draft the next step", exact: true }).boundingBox())
      ?.height,
  ).toBeGreaterThanOrEqual(52);
  await bill.fill("180");
  await people.fill("4");
  const saved = page.waitForResponse((response) => {
    if (!response.url().includes("/rpc/threads/responseUiState") || !response.ok()) return false;
    const input = response.request().postDataJSON() as { json?: { state?: { tip?: number } } };
    return input.json?.state?.tip === 30;
  });
  await tip.focus();
  await tip.press("End");
  await expect(tip).toHaveValue("30");
  await expect(reply.getByRole("status", { name: "Per person" })).toHaveText("58.50€");
  await bill.focus();
  await saved;
  await page.reload();
  await expect(bill).toHaveValue("180");
  await expect(people).toHaveValue("4");
  await expect(tip).toHaveValue("30");
  await expect(reply.getByRole("status", { name: "Per person" })).toHaveText("58.50€");
  // The scripted composition has no attached artifact: denied/missing images keep readable alt text.
  await expect(reply.getByText("Fictional dinner table", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await bill.scrollIntoViewIfNeeded();
  await captureScreenshot(page, info, "interactive-response-mobile-controls");
  const chart = reply.getByRole("img", { name: "Cost by group size", exact: true });
  await chart.scrollIntoViewIfNeeded();
  const chartBox = await chart.boundingBox();
  expect(chartBox!.width).toBeLessThanOrEqual(390);
  expect(chartBox!.height).toBeGreaterThanOrEqual(220);
  await captureScreenshot(page, info, "interactive-response-mobile-chart");
});
test("interactive reply recalculates, restores values and only drafts a follow-up", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixture);
  await expect(page.getByRole("status", { name: "Per person" })).toHaveText("44.00€");
  await page.getByLabel("Bill", { exact: true }).fill("180");
  await expect(page.getByRole("status", { name: "Per person" })).toHaveText("66.00€");
  await expect(page.getByTestId("saved-revision")).not.toHaveText("0");
  await page.reload();
  await expect(page.getByLabel("Bill", { exact: true })).toHaveValue("180");
  await page.getByRole("button", { name: "Draft the next step" }).click();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Help me choose a restaurant within this budget.",
  );
  const screenshot = info.outputPath("interactive-response-desktop.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach("interactive-response-desktop", { path: screenshot, contentType: "image/png" });
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("img", { name: "Next steps" })).toBeVisible();
  await page.getByRole("button", { name: "Assumptions" }).click();
  await expect(page.getByText("The estimate includes", { exact: false })).toBeVisible();
});
test("the same composed reply fits a narrow viewport and keyboard navigation", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture);
  const image = page.getByRole("img", { name: "Fictional dinner table", exact: true });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(600);
  expect((await image.boundingBox())?.width).toBeGreaterThanOrEqual(340);
  await page.getByLabel("People", { exact: true }).fill("4");
  await expect(page.getByRole("status", { name: "Per person" })).toHaveText("33.00€");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("tab", { name: "Compare", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Plan", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const screenshot = info.outputPath("interactive-response-narrow.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach("interactive-response-narrow", { path: screenshot, contentType: "image/png" });
});
test("a feed discussion keeps interactive values and only sends a drafted follow-up when asked", async ({
  page,
}, info) => {
  test.skip(process.env.AGENT_RUNTIME === "pi", "Deterministic scripted response fixture");
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(page, `response-feed-${Date.now()}@example.test`, "password12", "Feed fixture");
  await completeOnboarding(page, undefined, "assistant");
  const item = await rpc<{ id: string }>(page, "feed/create", {
    kind: "article",
    title: "Dinner planning",
    summary: "Sample dinner discussion",
    url: "https://example.test/dinner",
  });
  await page.getByRole("button", { name: "For you", exact: true }).click();
  const hub = page.getByRole("region", { name: "For you", exact: true });
  await hub.getByRole("button", { name: /Dinner planning/ }).click();
  const discussion = hub.getByRole("region", { name: "Discuss this post", exact: true });
  const composer = discussion.getByRole("textbox", { name: "Ask about this post", exact: true });
  await composer.fill("Show an interactive dinner budget");
  await discussion.getByRole("button", { name: "Send", exact: true }).click();
  const reply = discussion.getByRole("group", { name: "Dinner budget", exact: true });
  await expect(reply.getByRole("status", { name: "Per person" })).toHaveText("44.00€", {
    timeout: 30_000,
  });
  const before = await rpc<ThreadSnapshot>(page, "threads/get", { feedItemId: item.id });
  const original = before.messages.find((message) =>
    message.blocks.some((block) => block.kind === "response_ui"),
  )!;
  const bill = reply.getByRole("spinbutton", { name: "Bill", exact: true });
  await bill.fill("180");
  await reply.getByRole("spinbutton", { name: "People", exact: true }).fill("4");
  await reply.getByRole("button", { name: "Draft the next step", exact: true }).click();
  await expect(composer).toHaveValue("Help me choose a restaurant within this budget.");
  const saved = await rpc<ThreadSnapshot>(page, "threads/get", { feedItemId: item.id });
  expect(saved.messages).toHaveLength(before.messages.length);
  const savedBlock = saved.messages
    .find((message) => message.id === original.id)!
    .blocks.find((block) => block.kind === "response_ui");
  expect(savedBlock).toMatchObject({ kind: "response_ui", state: { bill: 180, people: 4 } });
  await expect(reply.getByRole("status", { name: "Per person" })).toHaveText("49.50€");
  await bill.scrollIntoViewIfNeeded();
  await captureScreenshot(page, info, "interactive-response-feed-mobile");
  const sent = page.waitForRequest("**/rpc/threads/send");
  await discussion.getByRole("button", { name: "Send", exact: true }).click();
  expect((await sent).postDataJSON().json).toMatchObject({
    feedItemId: item.id,
    replyToMessageId: original.id,
    text: "Help me choose a restaurant within this budget.",
  });
});
