export function notificationDestination(data: Record<string, unknown>) {
  const botId = data.botId ?? data["rakazo.botId"];
  if (typeof botId !== "string" || !botId) return null;
  return {
    pathname: "/thread" as const,
    params: { botId, ...(data.threadKind === "personal" ? { view: "assistant" } : {}) },
  };
}
