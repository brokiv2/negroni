const MAX_RECOVERIES = 3;
const TRANSIENT =
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|429|502|503|504)\b|rate.limit|timed?\s*out|timeout|temporar(?:y|ily)|network.*(?:error|fail)|model.*unavailable/i;
const ACCESS =
  /\b(?:401|403)\b|unauthori[sz]ed|forbidden|permission|invalid.*(?:key|credential)|credential.*(?:expired|missing)|not.*authenticated/i;

export function assistantWorkRecovery(input: {
  status: string | undefined;
  error: string | null | undefined;
  recoveryCount: number;
  runCount: number;
  maxRuns: number;
  deadline: Date;
  now: Date;
  scheduledFor?: Date | null;
  uncertainEffects: boolean;
}): { action: "retry" | "needs_input" | "pause"; reason: string; delayMs?: number } {
  if (input.deadline <= input.now || input.runCount >= input.maxRuns) {
    return { action: "pause", reason: "Work allowance or deadline reached." };
  }
  if (input.uncertainEffects) {
    return {
      action: "needs_input",
      reason: "An external action has an uncertain result. Verify it before continuing.",
    };
  }
  if (!input.status) {
    return { action: "needs_input", reason: "The previous attempt is no longer available." };
  }
  const repair = input.status === "completed";
  const limit = repair ? 1 : MAX_RECOVERIES;
  if (input.recoveryCount >= limit) {
    return { action: "needs_input", reason: "The bounded recovery attempts were exhausted." };
  }
  if (!repair && (ACCESS.test(input.error ?? "") || !TRANSIENT.test(input.error ?? ""))) {
    return {
      action: "needs_input",
      reason: "The previous attempt needs a decision or restored access before continuing.",
    };
  }
  const delayMs = repair ? 60_000 : 5 * 60_000 * 2 ** input.recoveryCount;
  if (
    (input.scheduledFor?.getTime() ?? input.now.getTime() + delayMs) >= input.deadline.getTime()
  ) {
    return { action: "pause", reason: "The recovery would exceed the work deadline." };
  }
  return {
    action: "retry",
    delayMs,
    reason: repair
      ? "Recover the saved progress and persist the next outcome."
      : "Retry after a temporary dependency failure, preserving completed actions.",
  };
}
