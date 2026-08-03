import { cn } from "@/lib/ui/utils";
import { IconCheck } from "./icons";

export function Stepper({
  steps,
  current,
}: {
  steps: string[];
  current: number; // zero-based index of active step
}) {
  return (
    <ol className="flex items-center">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-colors",
                  done && "brand-fill text-on-brand",
                  active && "bg-accent-soft text-accent ring-1 ring-accent",
                  !done && !active && "bg-surface text-muted",
                )}
              >
                {done ? <IconCheck className="size-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden text-sm font-medium sm:block",
                  active ? "text-foreground" : "text-muted",
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "mx-3 h-px flex-1",
                  done ? "bg-brand" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
