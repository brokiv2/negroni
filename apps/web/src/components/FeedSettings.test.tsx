// @vitest-environment jsdom
import { FeedProfileSchema } from "@rakazo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ profile: vi.fn(), list: vi.fn(), configure: vi.fn() }));
vi.mock("../lib/rpc", () => ({
  rpc: {
    feed: { profile: api.profile, configure: api.configure },
    connections: { list: api.list },
  },
}));
import { FeedSettings } from "./FeedSettings";
it("selects an exact supported account and preserves its choice on failed save", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const profile = FeedProfileSchema.parse({});
  api.profile.mockResolvedValue(profile);
  api.list.mockResolvedValue([
    {
      id: "one",
      displayName: "Work notes",
      status: "connected",
      capabilities: ["background_read"],
    },
    { id: "two", displayName: "Other app", status: "connected", capabilities: [] },
  ]);
  api.configure
    .mockResolvedValueOnce({ ...profile, accountResearchIds: ["one"] })
    .mockRejectedValueOnce(new Error("offline"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<FeedSettings />));
    expect(container.textContent).not.toContain("Other app");
    const checkbox = container.querySelector("fieldset input") as HTMLInputElement;
    await act(async () => checkbox.click());
    expect(api.configure).toHaveBeenCalledWith({ accountResearchIds: ["one"] });
    expect(checkbox.checked).toBe(true);
    await act(async () => checkbox.click());
    expect(checkbox.checked).toBe(true);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
