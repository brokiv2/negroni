import { z } from "zod";

export const WeatherWidget = z.object({
  location: z.string().trim().min(1).max(120),
  temperature: z.number().finite(),
  unit: z.enum(["C", "F"]),
  condition: z.enum(["clear", "cloudy", "rain", "snow", "storm", "fog"]),
  description: z.string().max(120),
  observedAt: z.string().datetime({ offset: true }),
  sourceUrl: z.url().refine((url) => new URL(url).protocol === "https:"),
  forecast: z
    .array(
      z.object({
        label: z.string().max(30),
        temperature: z.number().finite(),
        condition: z.enum(["clear", "cloudy", "rain", "snow", "storm", "fog"]),
        precipitation: z.number().min(0).max(100).optional(),
      }),
    )
    .max(8),
});
export type WeatherWidget = z.infer<typeof WeatherWidget>;

export const EmailDraftWidget = z.object({
  account: z.string().trim().min(1).max(200),
  to: z.array(z.email()).min(1).max(20),
  cc: z.array(z.email()).max(20).default([]),
  subject: z.string().trim().min(1).max(500),
  body: z.string().min(1).max(30000),
});
export type EmailDraftWidget = z.infer<typeof EmailDraftWidget>;
export const EmailDraftReview = z.object({
  type: z.literal("email_review"),
  action: z.enum(["send", "cancel"]),
  draft: EmailDraftWidget,
});
export function parseEmailDraftReview(answer: string) {
  try {
    return EmailDraftReview.safeParse(JSON.parse(answer));
  } catch {
    return EmailDraftReview.safeParse(null);
  }
}
