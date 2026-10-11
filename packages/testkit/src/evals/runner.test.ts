import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupActors, type EvalActor, type EvalApp, waitForDelegatedWork } from "./runner.js";

const actors: EvalActor[] = [
  {
    botId: "root-bot",
    cookie: "root-session",
    userId: "eval-user",
    spaceId: "eval-space",
  },
];

function fixture(options: { failDisable?: boolean; failStop?: boolean } = {}) {
  const bots = [
    { id: "root-bot", userId: "eval-user", spaceId: "eval-space" },
    { id: "child-bot", userId: "eval-user", spaceId: "eval-space" },
  ];
  const runs = [
    { id: "root-run", botId: "root-bot", status: "running" },
    { id: "child-run", botId: "child-bot", status: "running" },
  ];
  const order: string[] = [];
  let lateChildCreated = false;
  let releaseQuietAbort!: () => void;
  const quietAbort = new Promise<void>((resolve) => {
    releaseQuietAbort = resolve;
  });
  const updateMany = vi.fn(async () => {
    order.push("disable");
    if (options.failDisable) throw new Error("database unavailable");
    return { count: 1 };
  });
  const request = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { json: { botId: string } };
    order.push(`stop:${body.json.botId}`);
    for (const run of runs) if (run.botId === body.json.botId) run.status = "cancelled";
    return Response.json({ json: { ok: true } }, { status: options.failStop ? 500 : 200 });
  });
  const cancel = vi.fn(async (key: string) => {
    order.push(`cancel:${key}`);
  });
  const abort = vi.fn(async (runId: string) => {
    order.push(`abort:${runId}`);
    if (runId === "root-run" && !lateChildCreated) {
      lateChildCreated = true;
      bots.push({ id: "late-child-bot", userId: "eval-user", spaceId: "eval-space" });
      runs.push({ id: "late-child-run", botId: "late-child-bot", status: "running" });
    }
    if (runId === "child-run") await quietAbort;
  });
  const findRuns = vi.fn(async (args: { select: { status?: boolean } }) =>
    runs.map((run) => (args.select.status ? { id: run.id, status: run.status } : { id: run.id })),
  );
  const handles = {
    app: { request },
    jobs: { cancel },
    runtime: { abort },
    prisma: {
      bot: { findMany: vi.fn(async () => bots.map((bot) => ({ ...bot }))) },
      run: { findMany: findRuns },
      routine: { updateMany, count: vi.fn(async () => 0) },
    },
  } as unknown as EvalApp;
  return {
    handles,
    order,
    updateMany,
    request,
    cancel,
    abort,
    releaseQuietAbort,
  };
}

describe("eval trial isolation", () => {
  it("awaits quiet runtime aborts and catches descendants created during root abort", async () => {
    const f = fixture();
    let settled = false;
    const cleanup = cleanupActors(f.handles, actors).then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(f.abort).toHaveBeenCalledWith("child-run"));
    expect(settled).toBe(false);
    f.releaseQuietAbort();
    await cleanup;

    expect(f.request).toHaveBeenCalledWith(
      "/rpc/threads/stop",
      expect.objectContaining({ headers: expect.objectContaining({ cookie: "root-session" }) }),
    );
    expect(f.order.indexOf("disable")).toBeLessThan(f.order.indexOf("stop:root-bot"));
    expect(f.order).toContain("stop:child-bot");
    expect(f.order).toContain("stop:late-child-bot");
    expect(f.cancel).toHaveBeenCalledWith("run:late-child-run");
    expect(f.abort).toHaveBeenCalledWith("late-child-run");
    expect(f.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: "eval-user", spaceId: "eval-space" }] },
      data: { active: false, nextRunAt: null },
    });
  });

  it.each([[{ failDisable: true }], [{ failStop: true }]])(
    "attempts cancellation and fails cleanup after a cleanup operation fails",
    async (options) => {
      const f = fixture(options);
      f.releaseQuietAbort();
      await expect(cleanupActors(f.handles, actors)).rejects.toThrow("could not be stopped");
      expect(f.cancel).toHaveBeenCalledWith("run:root-run");
      expect(f.abort).toHaveBeenCalledWith("root-run");
    },
  );
});

describe("delegated eval completion", () => {
  afterEach(() => vi.useRealTimers());

  function delegationFixture() {
    const record = { kind: "delegation", state: "working" };
    const runs = [{ status: "completed" }];
    let toolCount = 0;
    const findTasks = vi.fn(async () => [{ delegation: { ...record } }]);
    const prisma = {
      run: { findMany: vi.fn(async () => runs.map((run) => ({ ...run }))) },
      task: { findMany: findTasks },
      event: { count: vi.fn(async () => toolCount) },
    } as unknown as EvalApp["prisma"];
    return {
      prisma,
      record,
      runs,
      findTasks,
      setToolCount: (count: number) => (toolCount = count),
    };
  }

  it("waits through terminal-run gaps before a review and before the next phase", async () => {
    vi.useFakeTimers();
    const f = delegationFixture();
    let settled = false;
    const waiting = waitForDelegatedWork(f.prisma, actors, {
      deadline: Date.now() + 5_000,
      maxToolCalls: 30,
      clearedToolCount: 0,
    }).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(settled).toBe(false);

    f.record.state = "reviewing";
    f.runs.push({ status: "running" });
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(false);

    f.runs[1]!.status = "completed";
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(false);
    f.record.state = "queued";
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(false);

    f.record.state = "completed";
    await vi.advanceTimersByTimeAsync(200);
    await waiting;
    expect(settled).toBe(true);
    expect(f.findTasks).toHaveBeenCalledWith({
      where: { OR: [{ userId: "eval-user", spaceId: "eval-space" }] },
      select: { delegation: true },
    });
  });

  it("keeps the tool-call limit while only a durable continuation is pending", async () => {
    const f = delegationFixture();
    f.setToolCount(29);
    await expect(
      waitForDelegatedWork(f.prisma, actors, {
        deadline: Date.now() + 5_000,
        maxToolCalls: 30,
        clearedToolCount: 2,
      }),
    ).rejects.toThrow("Delegated tool call budget exceeded");
  });

  it("reports a durable request for assistance without supplying a repair prompt", async () => {
    const f = delegationFixture();
    f.record.state = "needs_input";
    await expect(
      waitForDelegatedWork(f.prisma, actors, {
        deadline: Date.now() + 5_000,
        maxToolCalls: 30,
        clearedToolCount: 0,
      }),
    ).rejects.toThrow("Delegated work requested assistance; no coaching supplied");
  });
});
