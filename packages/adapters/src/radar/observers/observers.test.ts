import { RADAR_SOURCES } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { calendarObserver } from "./calendar.js";
import { driveObserver } from "./drive.js";
import { providerData, type SourceReadError } from "./envelope.js";
import { duplicateKey, gmailObserver } from "./gmail.js";
import { granolaMeetings, granolaObserver } from "./granola.js";
import { RADAR_OBSERVERS, radarObserverFor } from "./index.js";
import { slackObserver } from "./slack.js";
import { todoistObserver } from "./todoist.js";
import type { ObserverCall } from "./types.js";

const now = new Date("2026-10-05T10:00:00Z");
const since = new Date("2026-10-04T10:00:00Z");
/** A fake provider that answers per tool and records every call. */
function provider(answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const call: ObserverCall = async (tool, args) => {
    calls.push({ tool, args });
    const answer = answers[tool];
    if (answer === undefined) throw new Error(`unexpected ${tool}`);
    return typeof answer === "function" ? answer(args) : answer;
  };
  return { call, calls };
}
const input = (call: ObserverCall, cursor: Record<string, unknown> = {}) => ({
  call,
  cursor,
  now,
  since,
  timeZone: "Europe/Helsinki",
  ownerAddresses: ["me@example.test"],
});

describe("observer registry", () => {
  it("covers exactly the sources the contract lists", () => {
    expect(Object.keys(RADAR_OBSERVERS).sort()).toEqual([...RADAR_SOURCES].sort());
    expect(radarObserverFor(" Gmail ")).toBe(gmailObserver);
    expect(radarObserverFor("github")).toBeUndefined();
    expect(radarObserverFor("constructor")).toBeUndefined();
  });

  it("unwraps provider envelopes and reports failures without their text", () => {
    expect(providerData({ data: { data: { items: [] } } }, "items")).toEqual({ items: [] });
    expect(
      providerData(
        { successful: true, data: { response_data: { emailAddress: "a@b.test" } } },
        "emailAddress",
      ),
    ).toEqual({
      emailAddress: "a@b.test",
    });
    expect(providerData([{ type: "text", text: '{"tasks":[]}' }], "tasks")).toEqual({ tasks: [] });
    expect(() =>
      providerData(
        { successful: false, error: "Request had invalid authentication credentials (401)" },
        "items",
      ),
    ).toThrow(/Reconnect this account/);
    const failure = (() => {
      try {
        providerData({ successful: false, error: "quota exceeded for project 123" }, "items");
      } catch (error) {
        return error as SourceReadError;
      }
    })();
    expect(failure?.message).toBe("The account could not be read.");
    expect(failure?.reconnect).toBe(false);
  });
});

describe("gmail", () => {
  const listed = {
    successful: true,
    data: {
      messages: [
        {
          messageId: "m1",
          threadId: "t1",
          sender: "A Colleague <colleague@example.test>",
          to: "Me <me@example.test>",
          subject: "Budget figures",
          labelIds: ["INBOX", "UNREAD", "IMPORTANT"],
          messageTimestamp: "2026-10-05T09:00:00Z",
          preview: { body: "Could you send the figures?" },
        },
        {
          messageId: "m2",
          threadId: "t1",
          sender: "me@example.test",
          to: "colleague@example.test",
          subject: "Re: Budget figures",
          labelIds: ["SENT"],
          messageTimestamp: "2026-10-05T09:30:00Z",
          preview: { body: "Sending now." },
        },
        {
          messageId: "m3",
          threadId: "t3",
          sender: "Shop <no-reply@shop.example.test>",
          to: "list@example.test",
          subject: "Sale ends in 2 hours!",
          labelIds: ["INBOX"],
          messageTimestamp: "2026-10-05T08:00:00Z",
          preview: { body: "Hurry" },
        },
        { messageId: "../etc", threadId: "x", subject: "bad id" },
      ],
      nextPageToken: "more",
      resultSizeEstimate: 60,
    },
  };

  it("reads mail since the cursor, fetches bodies only for direct mail, and counts the rest", async () => {
    const { call, calls } = provider({
      GMAIL_GET_PROFILE: { data: { response_data: { emailAddress: "Me@Example.test" } } },
      GMAIL_FETCH_EMAILS: listed,
      GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: {
        data: {
          messageId: "m1",
          messageText: "<p>Could you send the figures before the 15:00 review?</p>",
          payload: { headers: [{ name: "Cc", value: "boss@example.test" }] },
        },
      },
    });
    const result = await gmailObserver.observe(input(call));
    expect(calls.map((entry) => entry.tool)).toEqual([
      "GMAIL_GET_PROFILE",
      "GMAIL_FETCH_EMAILS",
      "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
    ]);
    expect(String(calls[1]?.args.query)).toMatch(/^after:1791108000 .*-category:promotions/);
    expect(result.overflow).toBe(56);
    expect(result.ownerAddress).toBe("me@example.test");
    expect(result.cursor).toEqual({ ownerAddress: "me@example.test", after: 1791194280 });
    expect(result.signals).toHaveLength(3);
    const [direct, sent, bulk] = result.signals;
    expect(direct).toMatchObject({
      externalId: "m1",
      storyKey: "gmail:t1",
      kind: "email",
      direct: true,
      unread: true,
      actor: { name: "A Colleague", address: "colleague@example.test" },
      excerpt: "Could you send the figures before the 15:00 review?",
      meta: { bulk: false, cc: ["boss@example.test"] },
    });
    expect(direct?.url).toBe("https://mail.google.com/mail/?authuser=me%40example.test#all/t1");
    expect(sent).toMatchObject({ externalId: "m2", kind: "email_sent" });
    expect(bulk).toMatchObject({
      externalId: "m3",
      direct: false,
      meta: { bulk: true, noReply: true },
    });
  });

  it("re-reads a thread: a later owner reply handles it, a read message was opened", async () => {
    const thread = (labels: string[], reply = false) =>
      provider({
        GMAIL_FETCH_MESSAGE_BY_THREAD_ID: {
          data: {
            messages: [
              {
                messageId: "m1",
                labelIds: labels,
                sender: "colleague@example.test",
                messageTimestamp: "2026-10-05T09:00:00Z",
              },
              ...(reply
                ? [
                    {
                      messageId: "m2",
                      labelIds: ["SENT"],
                      sender: "me@example.test",
                      messageTimestamp: "2026-10-05T09:30:00Z",
                    },
                  ]
                : []),
            ],
          },
        },
      }).call;
    const reread = (call: ObserverCall) =>
      gmailObserver.reread!({
        call,
        externalId: "m1",
        threadKey: "t1",
        occurredAt: new Date("2026-10-05T09:00:00Z"),
        ownerAddresses: ["me@example.test"],
      });
    expect(await reread(thread(["INBOX", "UNREAD"]))).toBe("keep");
    expect(await reread(thread(["INBOX"]))).toBe("opened");
    expect(await reread(thread(["INBOX", "UNREAD"], true))).toBe("handled");
  });

  it("recognizes a forwarded copy of the same mail", () => {
    const original = duplicateKey("Invoice 42", "Please pay invoice 42 by Friday.");
    const forwarded = duplicateKey(
      "Fwd: Invoice 42",
      "---------- Forwarded message ---------\nFrom: Billing <billing@example.test>\nDate: Mon\nSubject: Invoice 42\nTo: me\n\nPlease pay invoice 42 by Friday.",
    );
    expect(forwarded).toBe(original);
    expect(duplicateKey("Invoice 43", "Please pay invoice 43 by Friday.")).not.toBe(original);
  });
});

describe("calendar", () => {
  const event = (patch: Record<string, unknown> = {}) => ({
    id: "e1",
    status: "confirmed",
    summary: "Review",
    start: { dateTime: "2026-10-05T12:00:00Z" },
    end: { dateTime: "2026-10-05T13:00:00Z" },
    updated: "2026-10-05T09:00:00Z",
    htmlLink: "https://www.google.com/calendar/event?eid=e1",
    organizer: { email: "colleague@example.test", displayName: "A Colleague" },
    attendees: [
      { email: "me@example.test", self: true, responseStatus: "accepted" },
      { email: "colleague@example.test", responseStatus: "accepted" },
    ],
    ...patch,
  });
  const observe = (items: unknown[], cursor: Record<string, unknown> = {}) =>
    calendarObserver.observe(
      input(provider({ GOOGLECALENDAR_EVENTS_LIST: { data: { items } } }).call, cursor),
    );

  it("keeps the agenda, emits nothing for a known meeting, and reports changes and cancellations", async () => {
    const first = await observe([event()]);
    expect(first.signals).toEqual([]);
    expect(first.agenda).toMatchObject([
      { id: "e1", title: "Review", attendees: ["colleague@example.test"], response: "accepted" },
    ]);
    const same = await observe([event()], first.cursor);
    expect(same.signals).toEqual([]);
    const moved = await observe(
      [
        event({
          start: { dateTime: "2026-10-05T14:00:00Z" },
          end: { dateTime: "2026-10-05T15:00:00Z" },
        }),
      ],
      first.cursor,
    );
    expect(moved.signals).toMatchObject([
      {
        kind: "event_changed",
        storyKey: "gcal:e1",
        deadline: new Date("2026-10-05T14:00:00Z"),
        meta: { previous: { start: "2026-10-05T12:00:00Z", title: "Review" } },
      },
    ]);
    const cancelled = await observe([event({ status: "cancelled" })], moved.cursor);
    expect(cancelled.signals).toMatchObject([{ kind: "event_cancelled" }]);
    expect(cancelled.agenda).toEqual([]);
    expect((await observe([event({ status: "cancelled" })], cancelled.cursor)).signals).toEqual([]);
  });

  it("reports an invitation that needs an answer and leaves declined events out of the agenda", async () => {
    const invited = await observe([
      event({
        attendees: [{ email: "me@example.test", self: true, responseStatus: "needsAction" }],
      }),
      event({
        id: "e2",
        attendees: [{ email: "me@example.test", self: true, responseStatus: "declined" }],
      }),
    ]);
    expect(invited.signals).toMatchObject([{ kind: "invite", externalId: "e1", direct: true }]);
    expect(invited.agenda?.map((item) => item.id)).toEqual(["e1"]);
  });
});

describe("granola", () => {
  it("accepts structured and JSON-text MCP envelopes but rejects prose and errors", () => {
    expect(
      granolaMeetings({ data: { content: [{ type: "text", text: '{"meetings":[{"id":"a"}]}' }] } }),
    ).toEqual([{ id: "a" }]);
    expect(granolaMeetings({ meetings: [] })).toEqual([]);
    expect(() => granolaMeetings({ content: [{ type: "text", text: "No idea" }] })).toThrow();
    expect(() => granolaMeetings({ isError: true, meetings: [] })).toThrow();
  });

  it("reads only listed meetings, keeps notes as text and refuses foreign links", async () => {
    const { call, calls } = provider({
      GRANOLA_MCP_LIST_MEETINGS: { meetings: [{ id: "a" }, { id: "b" }] },
      GRANOLA_MCP_GET_MEETINGS: {
        meetings: [
          {
            id: "a",
            title: "Review",
            summary: "Agreed to ship Friday.",
            action_items: ["Send deck"],
            url: "https://attacker.test/x",
            end_time: "2026-10-05T09:00:00Z",
          },
          { id: "other", title: "Not listed" },
        ],
      },
    });
    const result = await granolaObserver.observe(input(call, { seen: ["b"] }));
    expect(calls[1]?.args).toEqual({ meeting_ids: ["a"] });
    expect(result.signals).toMatchObject([
      {
        externalId: "a",
        kind: "meeting_notes",
        title: "Review",
        excerpt: "Agreed to ship Friday.\n\nSend deck",
      },
    ]);
    expect(result.signals[0]?.url).toBeUndefined();
    expect(result.cursor).toEqual({ since: now.toISOString(), seen: ["b", "a"] });
  });
});

describe("slack, todoist and drive", () => {
  it("turns direct messages into signals after the cursor", async () => {
    const { call, calls } = provider({
      SLACK_SEARCH_MESSAGES: {
        data: {
          ok: true,
          messages: {
            total: 3,
            matches: [
              {
                ts: "1791190000.000100",
                text: "Can you review the PR today?",
                username: "dev",
                channel: { id: "D1", is_im: true },
                permalink: "https://team.slack.com/archives/D1/p1",
              },
              {
                ts: "1791000000.000100",
                text: "old",
                username: "dev",
                channel: { id: "D1", is_im: true },
              },
            ],
          },
        },
      },
    });
    const result = await slackObserver.observe(input(call, { after: 1791100000 }));
    expect(String(calls[0]?.args.query)).toBe("to:me after:2026-10-03");
    expect(result.signals).toMatchObject([
      {
        externalId: "D1:1791190000.000100",
        kind: "message",
        direct: true,
        actor: { name: "dev" },
        url: "https://team.slack.com/archives/D1/p1",
      },
    ]);
    expect(result.overflow).toBe(1);
  });

  it("reports tasks due today or overdue with a deadline in the owner's day", async () => {
    const { call } = provider({
      TODOIST_GET_ALL_TASKS: {
        data: {
          tasks: [
            {
              id: "1",
              content: "Pay rent",
              due: { date: "2026-10-05", string: "today" },
              is_completed: false,
              url: "https://app.todoist.com/app/task/1",
              priority: 4,
            },
            { id: "2", content: "Done already", is_completed: true },
          ],
        },
      },
    });
    const result = await todoistObserver.observe(input(call));
    expect(result.signals).toMatchObject([
      {
        externalId: "1",
        kind: "task_due",
        title: "Pay rent",
        deadline: new Date("2026-10-05T20:59:00.000Z"),
        meta: { priority: 4 },
      },
    ]);
  });

  it("starts Drive from a page token, then reports comments by others", async () => {
    const start = await driveObserver.observe(
      input(
        provider({ GOOGLEDRIVE_GET_CHANGES_START_PAGE_TOKEN: { data: { startPageToken: "100" } } })
          .call,
      ),
    );
    expect(start).toMatchObject({ signals: [], cursor: { pageToken: "100" } });
    const { call } = provider({
      GOOGLEDRIVE_LIST_CHANGES: {
        data: {
          kind: "drive#changeList",
          changes: [
            {
              fileId: "f1",
              file: {
                id: "f1",
                name: "Plan",
                webViewLink: "https://docs.google.com/document/d/f1",
              },
            },
          ],
          newStartPageToken: "101",
        },
      },
      GOOGLEDRIVE_LIST_COMMENTS: {
        data: {
          kind: "drive#commentList",
          comments: [
            {
              id: "c1",
              content: "Please check section 2",
              author: { displayName: "Editor", me: false },
              modifiedTime: "2026-10-05T09:00:00Z",
            },
            {
              id: "c2",
              content: "my own note",
              author: { me: true },
              modifiedTime: "2026-10-05T09:00:00Z",
            },
          ],
        },
      },
    });
    const result = await driveObserver.observe(
      input(call, { pageToken: "100", since: since.toISOString() }),
    );
    expect(result.signals).toMatchObject([
      { externalId: "comment:f1:c1", kind: "comment", title: "Plan", actor: { name: "Editor" } },
    ]);
    expect(result.cursor).toMatchObject({ pageToken: "101" });
  });
});
