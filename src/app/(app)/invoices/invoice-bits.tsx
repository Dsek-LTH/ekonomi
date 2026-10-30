"use client";

// The small pieces every levfaktura screen draws the same way: the status, the
// due date, and what to call an invoice nobody has named yet.
import { useTranslations } from "next-intl";
import { Tag } from "@/components/ui/status-pill";
import { INVOICE_STATUS_TONE, daysUntilDue } from "@/lib/domain/supplier-invoice";
import { today } from "@/lib/domain/date";
import { cn } from "@/lib/ui/utils";
import { useFormat } from "@/lib/ui/use-format";
import type { SupplierInvoiceStatus } from "@/lib/domain/types";

export function InvoiceStatusPill({ status }: { status: SupplierInvoiceStatus }) {
  const t = useTranslations("common.invoiceStatus");
  return <Tag tone={INVOICE_STATUS_TONE[status]}>{t(status)}</Tag>;
}

/** How close it is to due: plain more than a week out, warned within the
 *  week, alarmed inside three days and once passed. */
export function dueTone(days: number | null): "plain" | "warning" | "danger" {
  if (days == null || days > 7) return "plain";
  return days < 3 ? "danger" : "warning";
}

/**
 * The due date itself, coloured by how close it is. An invoice's deadline is
 * the thing on these screens that costs money when missed, so the colour says
 * it at a glance, and the words ("om 3 dagar") are on hover for whoever wants
 * the count.
 */
export function DueLabel({ dueDate, className }: { dueDate: string | null; className?: string }) {
  const t = useTranslations("invoices.due");
  const { date } = useFormat();
  const days = daysUntilDue(dueDate || null, today());
  if (days == null) return <span className={cn("text-muted", className)}>{t("none")}</span>;
  const tone = dueTone(days);
  const hint =
    days < 0
      ? t("overdue", { days: -days })
      : days === 0
        ? t("today")
        : days <= 7
          ? t("inDays", { days })
          : undefined;
  return (
    <span
      title={hint}
      className={cn(
        "tabular-nums",
        tone === "danger" && "font-medium text-danger",
        tone === "warning" && "font-medium text-warning",
        className,
      )}
    >
      {date(dueDate!)}
    </span>
  );
}

/** What an invoice is called: what its unit said it is for, as an utlägg is
 *  called by its title. Before it is fördelad it has only its number, and
 *  the supplier is the treasury's to settle, so it is never the name. */
export function useInvoiceTitle() {
  const t = useTranslations("invoices");
  return (i: { reference: string | null; description: string | null }) =>
    i.description || i.reference || t("unnamed");
}
