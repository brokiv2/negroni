/**
 * Reading an approval `ask`.
 *
 * `buildApprovalAskBlock` (in `@rakazo/adapters`) writes the exact recipient and
 * action into `detail` as `key: value` lines, already redacted against the run's
 * secrets. These two functions only reshape those lines — they never add to them
 * and never reach for the raw tool payload, so what the card shows can never be
 * more than what the server decided was safe to show.
 */

const KEY_VALUE_LINE = /^([A-Za-z][A-Za-z0-9_ ]{0,32}):\s+(.+)$/;

/** The named fields: recipient, subject, amount — whatever the call spelled out. */
export function approvalRows(detail: string | undefined): Array<{ k: string; v: string }> {
  if (!detail) return [];
  const rows: Array<{ k: string; v: string }> = [];
  for (const line of detail.split("\n")) {
    const match = KEY_VALUE_LINE.exec(line.trim());
    if (!match?.[1] || !match[2]) continue;
    rows.push({ k: match[1], v: match[2] });
  }
  return rows;
}

/** The rest: the reviewer's prose reason, kept rather than dropped. */
export function approvalNotes(detail: string | undefined): string[] {
  if (!detail) return [];
  return detail
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !KEY_VALUE_LINE.test(line));
}
