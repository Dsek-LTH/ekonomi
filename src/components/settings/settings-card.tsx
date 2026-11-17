"use client";

// The one anatomy of a settings page (docs/settings.md): a stack of cards, each about one thing. A card has a
// title, an optional action or status at the right, and then rows of label and control, groups of rows, or a
// table. No subtitle: what a card is for is its title's job.
import { useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { IconCheck } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";

/** The page's cards, spaced. Pages with several subjects stack SettingsSections instead. */
export function SettingsStack({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

/** One subject of a page that has several (each stock, say): a heading over its own stack of cards. */
export function SettingsSection({
  id,
  title,
  aside,
  children,
}: {
  /** An anchor other pages link to (`/admin/stock#cafe`). */
  id?: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A card about one thing. Without a title it is a bare card around a table (the page's title names it). */
export function SettingsCard({
  id,
  title,
  action,
  className,
  children,
}: {
  id?: string;
  title?: string;
  /** A button, or a status, at the far end of the title line. */
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className={cn("scroll-mt-4", className)}>
      {title && (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-inset py-2.5">
          {/* break-words, not truncate: Swedish compounds have nothing to wrap at. */}
          <h2 className="min-w-0 break-words text-base font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </Card>
  );
}

/** Rows that belong together inside a card, under a small heading on a tint. */
export function SettingsGroup({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border last:border-0">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-inset py-1.5">
        <h3 className="text-xs font-semibold text-muted">{title}</h3>
        {action}
      </div>
      <ul>{children}</ul>
    </section>
  );
}

/** A list of rows straight under a card's title. */
export function SettingsRows({ children }: { children: React.ReactNode }) {
  return <ul>{children}</ul>;
}

/**
 * One setting: what it is on the left, the control on the right (under it on a phone). `hint` is a line about the
 * field itself, the way a form field has one. `wide` gives the control the row's full width below the label, for a
 * control that holds a list (a set of chips, a multi-picker).
 *
 * `required` marks the name with the star the app's forms use. `missing` says, in place of the hint, what an empty
 * required value holds up ("Behövs innan lagret kan bokföras"). Saving is not refused for it: setup goes in steps.
 */
export function SettingRow({
  label,
  hint,
  required = false,
  missing,
  wide = false,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  /** Shown while a required value is empty. */
  missing?: string | false | null;
  wide?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("common.field");
  return (
    <li
      className={cn(
        "grid gap-2 border-b border-border px-inset py-3 last:border-0",
        !wide && "sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-sm font-medium">
          {label}
          {required && (
            <>
              {/* The star is aria-hidden, so the word is here too. */}
              <span aria-hidden className="text-accent">
                *
              </span>
              <span className="sr-only">{t("required")}</span>
            </>
          )}
        </p>
        {missing ? (
          <p className="text-xs text-warning">{missing}</p>
        ) : (
          hint && <p className="text-xs text-muted">{hint}</p>
        )}
      </div>
      {children !== undefined && <div className="min-w-0">{children}</div>}
    </li>
  );
}

/** How far a section's setup has come: what is left in warning, done in success. For a SettingsSection's or card's end. */
export function SetupStatus({ left, label }: { left: number; label: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs font-medium",
        left ? "text-warning" : "text-success",
      )}
    >
      {left === 0 && <IconCheck className="size-3.5" />}
      {label}
    </span>
  );
}
