import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Collapsed "Worked with <bot>" chip used by the personal view. Upstream folds
 * tool chatter into its own narration bubble; the personal transcript still
 * needs one expandable line per delegation.
 */
export function ToolActivityDisclosure({
  live,
  label,
  children,
}: {
  live: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <details
      key={live ? "working" : "actions"}
      data-testid="tool-activity"
      data-live={live || undefined}
      className="group"
    >
      <summary
        className={`flex min-h-6 w-fit cursor-pointer list-none items-center gap-1 rounded-md py-0.5 pe-1.5 text-[13px] font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted ${
          live ? "text-foreground/75" : "text-muted-foreground"
        }`}
      >
        <ChevronRight
          aria-hidden
          size={14}
          strokeWidth={1.8}
          className="transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
        />
        {label}
      </summary>
      <div className="mt-1.5 ps-1">{children}</div>
    </details>
  );
}
