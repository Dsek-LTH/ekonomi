"use client";

// The small pieces every levfaktura screen draws the same way: the status, the
// due date, and what to call an invoice nobody has named yet.
import { useTranslations } from "next-intl";
import { Tag } from "@/components/ui/status-pill";
import { INVOICE_STATUS_TONE, daysUntilDue } from "@/lib/domain/supplier-invoice";
import { today } from "@/lib/domain/date";
import { cn } from "@/lib/ui/utils";
import type { SupplierInvoiceStatus } from "@/lib/domain/types";

export function InvoiceStatusPill({ status }: { status: SupplierInvoiceStatus }) {
  const t = useTranslations("common.invoiceStatus");
  return <Tag tone={INVOICE_STATUS_TONE[status]}>{t(status)}</Tag>;
}

/** How close it is to due. Warned at a week, alarmed once passed. */
export function dueTone(days: number | null): "muted" | "warning" | "danger" {
  if (days == null || days > 7) return "muted";
  return days < 0 ? "danger" : "warning";
}

/**
 * The due date as the reader needs it: "om 3 dagar" while it is close, the
 * date itself while it is not. An invoice's deadline is the thing on these
 * screens that costs money when missed, so it is said in the words that make
 * it obvious.
 */
export function DueLabel({ dueDate, className }: { dueDate: string | null; className?: string }) {
  const t = useTranslations("invoices.due");
  const days = daysUntilDue(dueDate || null, today());
  if (days == null) return <span className={cn("text-muted", className)}>{t("none")}</span>;
  const tone = dueTone(days);
  const text =
    days < 0
      ? t("overdue", { days: -days })
      : days === 0
        ? t("today")
        : days <= 7
          ? t("inDays", { days })
          : t("on", { date: dueDate! });
  return (
    <span
      className={cn(
        tone === "danger" && "font-medium text-danger",
        tone === "warning" && "font-medium text-warning",
        tone === "muted" && "text-muted",
        className,
      )}
    >
      {text}
    </span>
  );
}

/** What an invoice is called before anybody has filled in its supplier: what
 *  the forward said it was for, or failing that the plain word. */
export function useInvoiceTitle() {
  const t = useTranslations("invoices");
  return (i: { supplierName: string | null; description: string | null }) =>
    i.supplierName || i.description || t("unnamed");
}
