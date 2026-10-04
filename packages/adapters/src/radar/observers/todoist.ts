import { zonedInstant } from "../clock.js";
import {
  asArray,
  asRecord,
  asString,
  clip,
  httpsUrl,
  plainText,
  providerData,
  validDate,
} from "./envelope.js";
import type { ObservedSignal, RadarObserver } from "./types.js";

const CAP = 30;

export const todoistObserver: RadarObserver = {
  cadenceMinutes: 60,

  async observe({ call, now, timeZone }) {
    const result = providerData(
      await call("TODOIST_GET_ALL_TASKS", { filter: "today | overdue" }),
      "tasks",
    );
    const tasks = asArray(result.tasks).filter((task) => task.is_completed !== true);
    const signals: ObservedSignal[] = [];
    for (const task of tasks.slice(0, CAP)) {
      const id = asString(task.id);
      if (!/^[\w-]{1,100}$/.test(id)) continue;
      const due = asRecord(task.due);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(asString(due.date)) ? asString(due.date) : "";
      const dueAt =
        validDate(due.datetime) ?? (date ? zonedInstant(date, "23:59", timeZone) : undefined);
      const content = clip(plainText(asString(task.content)) || "Task", 300);
      const url = httpsUrl(task.url, ["todoist.com"]);
      signals.push({
        externalId: id,
        threadKey: id,
        storyKey: `todoist:${id}`,
        kind: "task_due",
        occurredAt:
          validDate(due.datetime) ??
          (date ? zonedInstant(date, "00:00", timeZone) : undefined) ??
          now,
        direct: true,
        title: content,
        excerpt: clip(
          [asString(due.string), plainText(asString(task.description))].filter(Boolean).join("\n"),
          2000,
        ),
        ...(url ? { url } : {}),
        ...(dueAt ? { deadline: dueAt } : {}),
        meta: {
          priority: Number(task.priority) || 1,
          due: date,
          overdue: Boolean(dueAt && dueAt.getTime() < now.getTime()),
        },
        version: `${content}\n${date}\n${asString(due.datetime)}`,
      });
    }
    return { signals, cursor: {}, overflow: Math.max(0, tasks.length - CAP) };
  },
};
