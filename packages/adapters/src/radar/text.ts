/**
 * Radar's copy has no long dashes. Models still write them now and then, so every text Radar
 * generates (titles, reasons, offers, lead sentences, brief narratives, prep points and the
 * profile) passes through here. An em or en dash with a space beside it becomes " - " (with no
 * space at the start or end of a line); one inside a word or a range becomes a hyphen. Quotes
 * from the source are never passed through, they have to stay verbatim.
 */
const LONG_DASH = /([ \t]*)[\u2012-\u2015]+([ \t]*)/g;

export function plainDashes(text: string): string {
  return text.replace(LONG_DASH, (match, before: string, after: string, offset: number) => {
    if (!before && !after) return "-";
    const lineStart = offset === 0 || text[offset - 1] === "\n";
    const lineEnd = offset + match.length === text.length || text[offset + match.length] === "\n";
    return `${lineStart ? "" : " "}-${lineEnd ? "" : " "}`;
  });
}
