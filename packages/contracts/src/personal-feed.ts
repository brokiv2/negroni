import * as z from "zod";

const publicUrl = z
  .string()
  .url()
  .max(2048)
  .refine((v) => {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    const local =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.startsWith("[") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host);
    return u.protocol === "https:" && !u.username && !u.password && !local;
  }, "Use an HTTPS URL without credentials");
export const FeedItemInput = z
  .object({
    kind: z.enum(["article", "post", "link", "note"]),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(4000),
    content: z.string().max(30000).default(""),
    url: publicUrl.optional(),
    imageUrl: publicUrl.optional(),
    reason: z.string().max(1000).default(""),
    topic: z.string().max(100).default(""),
    publishedAt: z.string().datetime().optional(),
  })
  .refine((v) => v.kind === "note" || !!v.url, "External material needs a source URL");
export const FeedItemSchema = z.object({
  id: z.string(),
  botId: z.string(),
  kind: z.enum(["article", "post", "link", "note"]),
  title: z.string(),
  summary: z.string(),
  content: z.string(),
  url: z.string().nullable(),
  imageUrl: z.string().nullable(),
  reason: z.string(),
  topic: z.string(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  saved: z.boolean(),
  hidden: z.boolean(),
});
export type FeedItem = z.infer<typeof FeedItemSchema>;
export function xPostId(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(u.hostname)
      ? (u.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1] ?? null)
      : null;
  } catch {
    return null;
  }
}

/** An IANA time zone this runtime can format dates in. */
export const TimeZoneSchema = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  });

export const FeedInterestSchema = z.object({
  topic: z.string().min(1).max(100),
  reason: z.string().max(300),
  origin: z.enum(["conversation", "explicit"]),
  evidenceIds: z.array(z.string()).max(5),
  updatedAt: z.string().datetime(),
});
export const FeedProfileSchema = z.object({
  accountResearchIds: z
    .array(z.string().min(1).max(200))
    .max(5)
    .refine((ids) => new Set(ids).size === ids.length, "Choose each account once")
    .default([]),
  accountAlerts: z.boolean().default(false),
  accountTimeZone: TimeZoneSchema.default("UTC"),
  researchEnabled: z.boolean().default(false),
  researchChecksPerDay: z.number().int().min(1).max(96).default(3),
  learningEnabled: z.boolean().default(false),
  interests: z.array(FeedInterestSchema).max(40).default([]),
  excludedTopics: z.array(z.string().min(1).max(100)).max(40).default([]),
  sourceDomains: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i),
    )
    .max(30)
    .default([]),
  maxItems: z.number().int().min(1).max(10).default(5),
});
export type FeedProfile = z.infer<typeof FeedProfileSchema>;
// Patch fields must not inherit profile defaults: omitted values preserve saved settings.
export const FeedProfilePatch = z.object({
  accountResearchIds: FeedProfileSchema.shape.accountResearchIds.removeDefault().optional(),
  accountAlerts: FeedProfileSchema.shape.accountAlerts.removeDefault().optional(),
  accountTimeZone: FeedProfileSchema.shape.accountTimeZone.removeDefault().optional(),
  researchEnabled: FeedProfileSchema.shape.researchEnabled.removeDefault().optional(),
  researchChecksPerDay: FeedProfileSchema.shape.researchChecksPerDay.removeDefault().optional(),
  learningEnabled: FeedProfileSchema.shape.learningEnabled.removeDefault().optional(),
  sourceDomains: FeedProfileSchema.shape.sourceDomains.removeDefault().optional(),
  maxItems: FeedProfileSchema.shape.maxItems.removeDefault().optional(),
});
export const FeedInterestUpdate = z.object({
  topic: z.string().trim().min(1).max(100),
  action: z.enum(["follow", "exclude", "forget"]),
});
export const FeedObservation = z.object({
  topic: z.string().trim().min(1).max(100),
  reason: z.string().max(300),
  evidence: z.string().min(8).max(500),
  confidence: z.number().min(0.85).max(1),
});

export const FeedResearchStatus = z.object({
  state: z.enum(["off", "learning", "waiting", "researching", "needs_attention"]),
  nextCheckAt: z.string().datetime().nullable(),
  lastCheckAt: z.string().datetime().nullable(),
  checksUsed: z.number().int(),
  checksPerDay: z.number().int(),
  error: z.string().nullable(),
});
