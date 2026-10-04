import {
  asArray,
  asRecord,
  asString,
  clip,
  httpsUrl,
  normalizeAddress,
  plainText,
  providerData,
  validDate,
} from "./envelope.js";
import type { ObservedSignal, RadarObserver } from "./types.js";

/** Changed files whose comments are read per check. */
const FILE_CAP = 10;
const CAP = 30;

export const driveObserver: RadarObserver = {
  cadenceMinutes: 30,

  async observe({ call, cursor, now, since }) {
    const token = asString(cursor.pageToken);
    if (!token) {
      // The first check only marks where changes start; nothing before it is news.
      const start = providerData(
        await call("GOOGLEDRIVE_GET_CHANGES_START_PAGE_TOKEN", { supportsAllDrives: true }),
        "startPageToken",
      );
      return {
        signals: [],
        cursor: { pageToken: asString(start.startPageToken), since: now.toISOString() },
        overflow: 0,
      };
    }
    const from = validDate(cursor.since) ?? since;
    const listed = providerData(
      await call("GOOGLEDRIVE_LIST_CHANGES", {
        pageToken: token,
        pageSize: 100,
        includeRemoved: false,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        spaces: "drive",
      }),
      "kind",
    );
    const files = new Map<string, Record<string, unknown>>();
    for (const change of asArray(listed.changes)) {
      const file = asRecord(change.file);
      const id = asString(change.fileId ?? file.id);
      if (change.removed === true || !/^[\w-]{1,200}$/.test(id)) continue;
      files.set(id, file);
    }
    const signals: ObservedSignal[] = [];
    const chosen = [...files.entries()].slice(0, FILE_CAP);
    for (const [fileId, file] of chosen) {
      const name = clip(asString(file.name) || "Document", 200);
      const url = httpsUrl(file.webViewLink, ["google.com"]);
      const sharedAt = validDate(file.sharedWithMeTime);
      const sharer = asRecord(file.sharingUser);
      if (sharedAt && sharedAt.getTime() >= from.getTime() && sharer.me !== true) {
        const address = normalizeAddress(sharer.emailAddress);
        const sharerName = asString(sharer.displayName);
        signals.push({
          externalId: `share:${fileId}`,
          threadKey: fileId,
          storyKey: `gdrive:${fileId}`,
          kind: "share",
          occurredAt: sharedAt,
          ...(address || sharerName
            ? {
                actor: {
                  ...(sharerName ? { name: sharerName } : {}),
                  ...(address ? { address } : {}),
                },
              }
            : {}),
          direct: true,
          title: name,
          excerpt: "",
          ...(url ? { url } : {}),
          meta: { mimeType: asString(file.mimeType) },
        });
      }
      const listedComments = providerData(
        await call("GOOGLEDRIVE_LIST_COMMENTS", {
          fileId,
          startModifiedTime: from.toISOString(),
          pageSize: 20,
          includeDeleted: false,
          fields: "*",
        }),
        "comments",
      );
      for (const comment of asArray(listedComments.comments)) {
        const author = asRecord(comment.author);
        const id = asString(comment.id);
        const modified = validDate(comment.modifiedTime ?? comment.createdTime);
        if (author.me === true || comment.deleted === true || !id || !modified) continue;
        if (modified.getTime() < from.getTime()) continue;
        const text = plainText(asString(comment.content));
        const authorName = asString(author.displayName);
        signals.push({
          externalId: `comment:${fileId}:${id}`,
          threadKey: `${fileId}:${id}`,
          storyKey: `gdrive:${fileId}:${id}`,
          kind: "comment",
          occurredAt: modified,
          ...(authorName ? { actor: { name: authorName } } : {}),
          direct: false,
          title: name,
          excerpt: clip(
            [text, plainText(asString(asRecord(comment.quotedFileContent).value))]
              .filter(Boolean)
              .join("\n> "),
            2000,
          ),
          ...(url ? { url } : {}),
          meta: { resolved: comment.resolved === true },
          version: `${text}\n${asString(comment.resolved)}`,
        });
      }
    }
    const next = asString(listed.newStartPageToken) || asString(listed.nextPageToken) || token;
    return {
      signals: signals.slice(0, CAP),
      cursor: { pageToken: next, since: now.toISOString() },
      overflow: Math.max(0, files.size - chosen.length) + Math.max(0, signals.length - CAP),
    };
  },
};
