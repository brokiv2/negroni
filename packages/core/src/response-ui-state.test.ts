import type { ResponseUiBlock } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createResponseUiStateSession, ResponseUiSaveConflict } from "./response-ui-state.js";

const block: ResponseUiBlock = {
  kind: "response_ui",
  id: "demo",
  summary: "Calculator",
  revision: 0,
  complete: true,
  spec: {
    root: "root",
    summary: "Calculator",
    state: { amount: 2 },
    elements: {
      root: {
        type: "Input",
        props: { label: "Amount", input: "number", bind: "/amount", min: 0, max: 100 },
        children: [],
      },
    },
  },
};
const saved = (revision: number, amount: number): ResponseUiBlock => ({
  ...block,
  revision,
  state: { amount },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
describe("response interaction persistence", () => {
  it("accepts the exact saved event after a lost acknowledgement and continues a newer edit", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(saved(2, 7));
    const s = createResponseUiStateSession(block, save);
    s.change({ amount: 4 });
    await s.flush();
    s.change({ amount: 7 });
    s.receive(saved(1, 4));
    await s.flush();
    expect(save.mock.calls[1]).toEqual([{ revision: 1, state: { amount: 7 } }]);
    expect(s.getSnapshot()).toMatchObject({ error: null, dirty: false });
    s.close();
  });
  it("coalesces rapid input and serializes edits made while a request is in flight", async () => {
    const first = deferred<ResponseUiBlock>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(saved(2, 6));
    const s = createResponseUiStateSession(block, save);
    s.change({ amount: 3 });
    s.change({ amount: 4 });
    const pending = s.flush();
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith({ revision: 0, state: { amount: 4 } });
    s.receive(saved(1, 4)); // Event can beat the RPC acknowledgement.
    s.change({ amount: 6 });
    first.resolve(saved(1, 4));
    await pending;
    expect(save.mock.calls[1]).toEqual([{ revision: 1, state: { amount: 6 } }]);
    expect(s.getSnapshot()).toEqual({
      state: { amount: 6 },
      saving: false,
      dirty: false,
      error: null,
    });
    s.close();
  });
  it("retries the exact lost acknowledgement before saving a newer local edit", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(saved(1, 4))
      .mockResolvedValueOnce(saved(2, 7));
    const s = createResponseUiStateSession(block, save);
    s.change({ amount: 4 });
    await s.flush();
    s.change({ amount: 7 });
    await s.retry();
    expect(save.mock.calls).toEqual([
      [{ revision: 0, state: { amount: 4 } }],
      [{ revision: 0, state: { amount: 4 } }],
      [{ revision: 1, state: { amount: 7 } }],
    ]);
    expect(s.getSnapshot().error).toBeNull();
    s.close();
  });
  it("preserves unsaved values when another device writes, until explicit reload", async () => {
    const save = vi.fn();
    const s = createResponseUiStateSession(block, save);
    s.change({ amount: 4 });
    s.receive(saved(1, 8));
    await s.flush();
    expect(save).not.toHaveBeenCalled();
    expect(s.getSnapshot()).toMatchObject({ state: { amount: 4 }, error: "conflict", dirty: true });
    await s.retry();
    expect(save).not.toHaveBeenCalled();
    s.reload(saved(1, 8));
    expect(s.getSnapshot()).toMatchObject({ state: { amount: 8 }, error: null });
    s.close();
  });
  it("recognizes a remote write that arrives during our request", async () => {
    const first = deferred<ResponseUiBlock>();
    const save = vi.fn(() => first.promise);
    const s = createResponseUiStateSession(block, save);
    s.change({ amount: 4 });
    const pending = s.flush();
    await Promise.resolve();
    s.change({ amount: 5 });
    s.receive(saved(2, 9));
    first.resolve(saved(1, 4));
    await pending;
    expect(s.getSnapshot()).toMatchObject({ state: { amount: 5 }, error: "conflict" });
    expect(save).toHaveBeenCalledTimes(1);
    s.close();
  });
  it("does not retry a server conflict or send invalid or incomplete state", async () => {
    const save = vi.fn().mockRejectedValue(new ResponseUiSaveConflict());
    const s = createResponseUiStateSession(block, save);
    expect(s.change({ amount: -1 })).toBe(false);
    expect(s.change({ amount: 4, extra: 1 })).toBe(false);
    s.change({ amount: 4 });
    await s.flush();
    await s.retry();
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot().error).toBe("conflict");
    s.close();
    const partial = createResponseUiStateSession({ ...block, complete: false }, save);
    expect(partial.change({ amount: 4 })).toBe(false);
    partial.receive(block);
    expect(partial.change({ amount: 4 })).toBe(true);
    partial.close();
  });
});
