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
