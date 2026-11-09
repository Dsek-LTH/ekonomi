import { cn } from "@/lib/ui/utils";
import { Spinner } from "./spinner";

// `label` is both the tooltip and the accessible name.
type Tone = "muted" | "danger";

const TONES: Record<Tone, string> = {
  muted: "hover:bg-hover hover:text-foreground",
  danger: "hover:bg-danger/10 hover:text-danger",
};

const SIZES = {
  xs: "rounded-control p-0.5",
  sm: "rounded-control p-1",
  md: "rounded-control p-1.5",
};

export function IconButton({
  label,
  title,
  tone = "muted",
  size = "md",
  reveal,
  loading = false,
  disabled,
  className,
  children,
  ...props
}: {
  label: string;
  tone?: Tone;
  size?: keyof typeof SIZES;
  reveal?: boolean;
  loading?: boolean;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      // `title ?? label`: a conditional tooltip passing undefined would otherwise override the fallback.
      title={title ?? label}
      aria-label={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "shrink-0 text-muted transition disabled:pointer-events-none",
        // Busy is not unavailable: no 40% fade on a spinner.
        loading ? "opacity-100" : "disabled:opacity-40",
        SIZES[size],
        TONES[tone],
        reveal && !loading && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
        className,
      )}
      {...props}
    >
      {/* Stacked on the icon: the hidden icon holds the box open (the button has no padding to spare). */}
      {loading ? (
        <span className="grid place-items-center">
          <span className="invisible col-start-1 row-start-1">{children}</span>
          <Spinner size="sm" className="col-start-1 row-start-1 text-accent" />
        </span>
      ) : (
        children
      )}
    </button>
  );
}
