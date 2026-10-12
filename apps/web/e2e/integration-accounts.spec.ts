import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("lists three accounts, removes only the chosen account, and labels another", async ({
  page,
}, testInfo) => {
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
  const started: unknown[] = [];
  const renamed: Array<{ connectionId: string; displayName: string }> = [];
  await page.route("**/rpc/connections/begin", (route) => {
    started.push(route.request().postDataJSON().json);
    accounts.push({
      ...accounts[0]!,
      id: "mail-4",
      accountId: "ca-mail-4",
      displayName: "Gmail",
    });
    return route.fulfill({ json: { json: { connectionId: "mail-4", authorizationUrl: null } } });
  });
  await page.route("**/rpc/connections/complete", (route) => {
    const { connectionId } = route.request().postDataJSON().json;
    return route.fulfill({
      json: { json: accounts.find((account) => account.id === connectionId) },
    });
  });
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
  await page.route("**/rpc/connections/remove", (route) => {
    expect(route.request().postDataJSON()).toEqual({ json: { connectionId: "mail-2" } });
    return route.fulfill({ json: { json: { ok: true } } });
  });
  await page.route("**/rpc/connections/tools", (route) => route.fulfill({ json: { json: [] } }));
  await page.route("**/rpc/connections/rename", (route) => {
    const input = route.request().postDataJSON().json;
    renamed.push(input);
    accounts = accounts.map((account) =>
      account.id === input.connectionId ? { ...account, displayName: input.displayName } : account,
    );
    return route.fulfill({
      json: { json: accounts.find((account) => account.id === input.connectionId) },
    });
  });
  const stamp = Date.now();
  await signup(page, `integration-accounts-${stamp}@rakazo.test`, "password12", "Accounts test");
  await completeOnboarding(page);
  await page.getByText("Integrations", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Close integrations", exact: true }),
  ).toBeInViewport();
  await page.getByTestId("connection-tile-gmail").getByRole("button", { name: "Added" }).click();
  const detail = page.getByTestId("connection-detail");
  const labels = detail.getByLabel("Account label", { exact: true });
  await expect(labels).toHaveCount(3);
  await expect(labels.nth(0)).toHaveValue("Personal");
  await expect(labels.nth(1)).toHaveValue("Work");
  await expect(labels.nth(2)).toHaveValue("Other");
  await expect(detail.getByRole("button", { name: "Add another", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "integration-three-accounts");
  await labels.nth(1).locator("..").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(labels).toHaveCount(2);
  await expect(labels.nth(0)).toHaveValue("Personal");
  await expect(labels.nth(1)).toHaveValue("Other");
  expect(removed).toEqual(["mail-2"]);
  expect(started).toEqual([]);
  await detail.getByRole("button", { name: "Add another", exact: true }).click();
  await expect(labels).toHaveCount(3);
  await expect(labels.nth(2)).toHaveValue("Gmail");
  expect(started).toEqual([{ connectorId: "composio", provider: "GMAIL" }]);
  await labels.nth(2).fill("Second work account");
  await captureScreenshot(page, testInfo, "integration-account-label");
  await labels.nth(2).blur();
  await expect
    .poll(() => renamed)
    .toEqual([{ connectionId: "mail-4", displayName: "Second work account" }]);
  await expect(labels.nth(2)).toHaveValue("Second work account");
  await expect(labels.nth(0)).toHaveValue("Personal");
  await expect(labels.nth(1)).toHaveValue("Other");
});
