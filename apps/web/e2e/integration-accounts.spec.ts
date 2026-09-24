import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("lists three accounts and removes only the chosen account", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    window.prompt = () => {
      throw new Error("Native prompts are unsupported in Electron");
    };
  });
  let accounts = ["Personal", "Work", "Other"].map((displayName, index) => ({
    id: `mail-${index + 1}`,
    connectorId: "composio",
    provider: "GMAIL",
    displayName,
    status: "connected",
    accountId: `ca-mail-${index + 1}`,
    capabilities: [],
    createdAt: "2026-09-17T00:00:00.000Z",
  }));
  const removed: string[] = [];
  const startedLabels: string[] = [];
  await page.route("**/rpc/connections/begin", (route) => {
    const {
      json: { displayName },
    } = route.request().postDataJSON();
    startedLabels.push(displayName);
    accounts.push({ ...accounts[0]!, id: "mail-4", accountId: "ca-mail-4", displayName });
    return route.fulfill({ json: { json: { connectionId: "mail-4", authorizationUrl: null } } });
  });
  await page.route("**/rpc/connections/complete", (route) =>
    route.fulfill({ json: { json: accounts.find((account) => account.id === "mail-4") } }),
  );
  await page.route("**/rpc/connections/catalog", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            connectorId: "composio",
            slug: "GMAIL",
            name: "Gmail",
            logo: null,
            connected: accounts.length > 0,
            noAuth: false,
            connectionCount: accounts.length,
          },
        ],
      },
    }),
  );
  await page.route("**/rpc/connections/list", (route) =>
    route.fulfill({ json: { json: accounts } }),
  );
  await page.route("**/rpc/connections/revoke", (route) => {
    const {
      json: { connectionId },
    } = route.request().postDataJSON();
    removed.push(connectionId);
    accounts = accounts.filter((account) => account.id !== connectionId);
    return route.fulfill({ json: { json: { ok: true } } });
  });
  const stamp = Date.now();
  await signup(page, `integration-accounts-${stamp}@rakazo.test`, "password12", "Accounts test");
  await completeOnboarding(page);
  await page.getByText("Integrations", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Close integrations", exact: true }),
  ).toBeInViewport();
  await expect(page.getByText("Gmail: Personal", { exact: true })).toBeVisible();
  await expect(page.getByText("Gmail: Work", { exact: true })).toBeVisible();
  await expect(page.getByText("Gmail: Other", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add account", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "integration-three-accounts");
  await page
    .getByText("Gmail: Work", { exact: true })
    .locator("..")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(page.getByText("Gmail: Work", { exact: true })).toBeHidden();
  await expect(page.getByText("Gmail: Personal", { exact: true })).toBeVisible();
  await expect(page.getByText("Gmail: Other", { exact: true })).toBeVisible();
  expect(removed).toEqual(["mail-2"]);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account label", { exact: true }).fill("Cancelled");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Account label", { exact: true })).toBeHidden();
  expect(startedLabels).toEqual([]);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account label", { exact: true }).fill("Second work account");
  await captureScreenshot(page, testInfo, "integration-account-label");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Gmail: Second work account", { exact: true })).toBeVisible();
  expect(startedLabels).toEqual(["Second work account"]);
});
