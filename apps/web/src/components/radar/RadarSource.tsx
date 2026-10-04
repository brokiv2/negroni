import { cn } from "@rakazo/ui-web";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, FileText, Hash, ListChecks, Mail, NotebookPen, Radio } from "lucide-react";

const SOURCES: Record<string, { name: string; icon: LucideIcon }> = {
  gmail: { name: "Gmail", icon: Mail },
  googlecalendar: { name: "Google Calendar", icon: CalendarDays },
  granola_mcp: { name: "Granola", icon: NotebookPen },
  slack: { name: "Slack", icon: Hash },
  todoist: { name: "Todoist", icon: ListChecks },
  googledrive: { name: "Google Drive", icon: FileText },
};

/** Product name of a toolkit slug; unknown slugs use the connection's own label. */
export function radarSourceName(source: string, label?: string): string {
  return SOURCES[source.trim().toLowerCase()]?.name ?? label ?? source;
}

/** The monochrome mark of a source, named for screen readers. */
export function RadarSourceMark({
  source,
  label,
  className,
}: {
  source: string;
  label?: string;
  className?: string;
}) {
  const Icon = SOURCES[source.trim().toLowerCase()]?.icon ?? Radio;
  return (
    <span
      role="img"
      aria-label={radarSourceName(source, label)}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md bg-muted text-foreground/75",
        className,
      )}
    >
      <Icon size={14} strokeWidth={1.8} aria-hidden />
    </span>
  );
}
