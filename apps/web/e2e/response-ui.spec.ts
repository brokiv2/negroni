import { expect, test } from "@playwright/test";

const fixture = "/e2e/fixtures/response-ui.html";
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
