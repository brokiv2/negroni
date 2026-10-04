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

it("keeps the article feed controls and leaves connected accounts to Radar", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const profile = FeedProfileSchema.parse({});
  api.profile.mockResolvedValue(profile);
  api.configure
    .mockResolvedValueOnce({ ...profile, learningEnabled: true })
    .mockRejectedValueOnce(new Error("offline"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<FeedSettings />));
    expect(api.list).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Connected sources");
    expect(container.textContent).not.toContain("Important updates");
    expect(container.querySelector('input[aria-label="Add a feed topic"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="Articles per collection"]')).not.toBeNull();
    const learning = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => learning.click());
    expect(api.configure).toHaveBeenCalledWith({ learningEnabled: true });
    expect(learning.checked).toBe(true);
    await act(async () => learning.click());
    expect(learning.checked).toBe(true);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
