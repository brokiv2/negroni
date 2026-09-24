/** Keep provider and transport diagnostics out of the conversation surface. */
export function friendlyChatError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  if (detail === "SESSION_EXPIRED") return "Your session has expired. Sign in again to continue.";
  if (/microphone|recording permission/i.test(detail)) {
    return "Microphone access is off. Enable it in Settings and try again.";
  }
  if (/network|connect|fetch failed|offline|econnrefused/i.test(detail)) {
    return "Can't reach Negroni right now. Check your connection and try again.";
  }
  if (/timeout|timed out|deadline/i.test(detail)) {
    return "This is taking longer than expected. Please try again.";
  }
  if (/too large|too long|unsupported file/i.test(detail)) {
    return "That file or recording can't be used. Try a smaller one.";
  }
  return "Something went wrong. Please try again.";
}
