import { expect, it } from "vitest";
import { shellCommandTimeoutMs, shellTimeoutError } from "./executor.js";

it("gives turns a person waits on the short shell budget and background work the long one", () => {
  const env = { SANDBOX_COMMAND_TIMEOUT_MS: "300000" };
  for (const trigger of ["user", "resume", "follow_up", "reaction", "messaging"])
    expect(shellCommandTimeoutMs(trigger, env)).toBe(60_000);
  for (const trigger of ["routine", "work", "research", "bot_message", "spawn"])
    expect(shellCommandTimeoutMs(trigger, env)).toBe(300_000);
  expect(shellCommandTimeoutMs("user", { ...env, SANDBOX_CHAT_COMMAND_TIMEOUT_MS: "45000" })).toBe(
    45_000,
  );
});

it("explains a timeout so the model narrows the command instead of retrying it", () => {
  const message = shellTimeoutError(60_000);
  expect(message).toContain("within 60 s");
  expect(message).toContain("Do not repeat it unchanged");
  expect(message).toMatch(/nohup/);
});
