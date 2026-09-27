import { describe, expect, it, vi } from "vitest";
import { VesperFollowUpQueue } from "./follow-up-queue";

function entries(queue: VesperFollowUpQueue) {
  return queue.getSnapshot().entries.map((entry) => entry.text);
}

describe("VesperFollowUpQueue", () => {
  it("shows queued messages in the order they were composed", () => {
    const queue = new VesperFollowUpQueue();
    queue.enqueue({ id: "a", text: "first" });
    queue.enqueue({ id: "b", text: "second" });
    expect(entries(queue)).toEqual(["first", "second"]);
    expect(queue.hasPending()).toBe(true);
  });

  it("removes a message the person dropped", () => {
    const queue = new VesperFollowUpQueue();
    queue.enqueue({ id: "a", text: "first" });
    queue.enqueue({ id: "b", text: "second" });
    queue.remove("a");
    expect(entries(queue)).toEqual(["second"]);
  });

  it("submits pending entries in order and clears them once durable", async () => {
    const queue = new VesperFollowUpQueue();
    const sent: string[] = [];
    queue.enqueue({ id: "a", text: "first" });
    queue.enqueue({ id: "b", text: "second" });

    await queue.flush(async (entry) => {
      sent.push(entry.text);
    });

    expect(sent).toEqual(["first", "second"]);
    expect(entries(queue)).toEqual([]);
    expect(queue.getSnapshot().draining).toBe(false);
  });

  it("does not submit while paused", async () => {
    const queue = new VesperFollowUpQueue();
    const submit = vi.fn(async () => undefined);
    queue.enqueue({ id: "a", text: "first" });
    queue.pause();

    await queue.flush(submit);

    expect(submit).not.toHaveBeenCalled();
    expect(entries(queue)).toEqual(["first"]);
    expect(queue.getSnapshot().paused).toBe(true);
  });

  it("holds the queue on failure and never resubmits that entry on its own", async () => {
    const queue = new VesperFollowUpQueue();
    queue.enqueue({ id: "a", text: "first" });
    queue.enqueue({ id: "b", text: "second" });
    const submit = vi.fn(async (entry: { text: string }) => {
      if (entry.text === "first") throw new Error("offline");
    });

    await expect(queue.flush(submit)).rejects.toThrow("offline");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot().paused).toBe(true);
    expect(queue.getSnapshot().entries[0]).toMatchObject({
      text: "first",
      status: "failed",
      error: "offline",
    });

    // A second flush must not quietly retry the failed one.
    await queue.flush(submit);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("resumes and drains what is left after the person asks", async () => {
    const queue = new VesperFollowUpQueue();
    queue.enqueue({ id: "a", text: "first" });
    queue.pause();
    const submit = vi.fn(async () => undefined);

    queue.resume();
    await queue.flush(submit);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(entries(queue)).toEqual([]);
  });

  it("retries only the entry the person picked", async () => {
    const queue = new VesperFollowUpQueue();
    queue.enqueue({ id: "a", text: "first" });
    let failNext = true;
    const submit = vi.fn(async () => {
      if (failNext) throw new Error("offline");
    });

    await expect(queue.flush(submit)).rejects.toThrow("offline");
    failNext = false;
    queue.retry("a");
    expect(queue.getSnapshot().paused).toBe(false);
    await queue.flush(submit);

    expect(submit).toHaveBeenCalledTimes(2);
    expect(entries(queue)).toEqual([]);
  });

  it("does not start a second drain while one is in flight", async () => {
    const queue = new VesperFollowUpQueue();
    queue.enqueue({ id: "a", text: "first" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const submit = vi.fn(async () => {
      await gate;
    });

    const first = queue.flush(submit);
    await queue.flush(submit);
    expect(submit).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers on every visible change", () => {
    const queue = new VesperFollowUpQueue();
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);
    queue.enqueue({ id: "a", text: "first" });
    queue.pause();
    queue.resume();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    queue.enqueue({ id: "b", text: "second" });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
