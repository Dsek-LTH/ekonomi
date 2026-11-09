import { FortnoxMark } from "./fortnox-mark";
import { cn } from "@/lib/ui/utils";

export function FortnoxBanner({
  title,
  detail,
  ok,
}: {
  title: string;
  detail?: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-panel border border-border px-3 py-2.5">
      <FortnoxMark />
      <div className="min-w-0 flex-1 text-sm leading-tight">
        <p className="font-medium">{title}</p>
        {detail && <p className="text-xs text-muted">{detail}</p>}
      </div>
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", ok ? "bg-success" : "bg-muted/50")}
      />
    </div>
  );
}
