import { expect, it } from "vitest";
import { notificationDestination } from "./notification-destination";

it("opens personal results in the personal conversation", () => {
  expect(notificationDestination({ botId: "b", threadKind: "personal" })?.params).toEqual({
    botId: "b",
    view: "assistant",
  });
  expect(notificationDestination({ botId: "b", threadKind: "team" })?.params).toEqual({
    botId: "b",
  });
  expect(notificationDestination({})).toBeNull();
});
