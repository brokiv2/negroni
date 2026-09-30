import { describe, expect, it } from "vitest";
import {
  boundedSandboxCommandTimeoutMs,
  chatSandboxCommandTimeoutMs,
  DEFAULT_CHAT_SANDBOX_COMMAND_TIMEOUT_MS,
  DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS,
  MAX_SANDBOX_COMMAND_TIMEOUT_MS,
  sandboxCommandTimedOut,
  sandboxCommandTimeoutMs,
} from "./sandbox-command.js";

describe("sandbox command timeout", () => {
  it("uses a safe default and accepts a bounded deployment override", () => {
    expect(sandboxCommandTimeoutMs({})).toBe(DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS);
    expect(sandboxCommandTimeoutMs({ SANDBOX_COMMAND_TIMEOUT_MS: "120000" })).toBe(120_000);
    expect(sandboxCommandTimeoutMs({ SANDBOX_COMMAND_TIMEOUT_MS: "invalid" })).toBe(
      DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS,
    );
    expect(
      sandboxCommandTimeoutMs({
        SANDBOX_COMMAND_TIMEOUT_MS: String(MAX_SANDBOX_COMMAND_TIMEOUT_MS + 1),
      }),
    ).toBe(DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS);
  });

  it("honors bounded per-command timeouts and rejects invalid values", () => {
    expect(boundedSandboxCommandTimeoutMs(25, 100)).toBe(25);
    expect(boundedSandboxCommandTimeoutMs(0, 100)).toBe(100);
    expect(boundedSandboxCommandTimeoutMs(Number.NaN, 100)).toBe(100);
    expect(boundedSandboxCommandTimeoutMs(undefined, Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS,
    );
  });

  it("gives chat turns a short command budget that never exceeds the general one", () => {
    expect(chatSandboxCommandTimeoutMs({})).toBe(DEFAULT_CHAT_SANDBOX_COMMAND_TIMEOUT_MS);
    // A deployment that raised the general timeout to five minutes still answers chat in one.
    expect(chatSandboxCommandTimeoutMs({ SANDBOX_COMMAND_TIMEOUT_MS: "300000" })).toBe(60_000);
    expect(chatSandboxCommandTimeoutMs({ SANDBOX_CHAT_COMMAND_TIMEOUT_MS: "20000" })).toBe(20_000);
    expect(
      chatSandboxCommandTimeoutMs({
        SANDBOX_CHAT_COMMAND_TIMEOUT_MS: "90000",
        SANDBOX_COMMAND_TIMEOUT_MS: "30000",
      }),
    ).toBe(30_000);
    expect(chatSandboxCommandTimeoutMs({ SANDBOX_CHAT_COMMAND_TIMEOUT_MS: "-1" })).toBe(60_000);
  });

  it("recognizes a provider timeout but not an ordinary exit 124", () => {
    expect(
      sandboxCommandTimedOut({ code: 124, stderr: "partial\ncommand timed out after 60000 ms\n" }),
    ).toBe(true);
    expect(sandboxCommandTimedOut({ code: 124, stderr: "timeout: sending signal" })).toBe(false);
    expect(sandboxCommandTimedOut({ code: 0, stderr: "command timed out after 5 ms" })).toBe(false);
  });
});
