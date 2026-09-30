export const DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS = 5 * 60_000;
export const MAX_SANDBOX_COMMAND_TIMEOUT_MS = 60 * 60_000;
/** A person is waiting on a chat turn, so one agent shell command gets a much shorter budget. */
export const DEFAULT_CHAT_SANDBOX_COMMAND_TIMEOUT_MS = 60_000;

export function sandboxCommandTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const configured = Number(env.SANDBOX_COMMAND_TIMEOUT_MS);
  return validSandboxCommandTimeout(configured) ? configured : DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS;
}

/**
 * Budget for one shell command in a turn the user is waiting on. Configurable with
 * SANDBOX_CHAT_COMMAND_TIMEOUT_MS and never longer than the general command timeout.
 */
export function chatSandboxCommandTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const configured = Number(env.SANDBOX_CHAT_COMMAND_TIMEOUT_MS);
  const chat = validSandboxCommandTimeout(configured)
    ? configured
    : DEFAULT_CHAT_SANDBOX_COMMAND_TIMEOUT_MS;
  return Math.min(chat, sandboxCommandTimeoutMs(env));
}

/** Sandbox providers report a timeout as exit 124 plus this stderr line. */
export function sandboxCommandTimedOut(result: { stderr: string; code: number }): boolean {
  return result.code === 124 && /command timed out after \d+ ms/.test(result.stderr);
}

export function boundedSandboxCommandTimeoutMs(
  requested: number | undefined,
  fallback?: number,
): number {
  if (validSandboxCommandTimeout(requested)) return requested;
  if (fallback === undefined) return sandboxCommandTimeoutMs();
  return validSandboxCommandTimeout(fallback) ? fallback : DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS;
}

function validSandboxCommandTimeout(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_SANDBOX_COMMAND_TIMEOUT_MS
  );
}
