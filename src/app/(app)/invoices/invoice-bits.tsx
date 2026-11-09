"use client";

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

/** Plain over a week out, warned within the week, alarmed inside three days and once passed. */
function dueTone(days: number | null): "plain" | "warning" | "danger" {
  if (days == null || days > 7) return "plain";
  return days < 3 ? "danger" : "warning";
}

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

export function useInvoiceTitle() {
  const t = useTranslations("invoices");
  return (i: { reference: string | null; description: string | null }) =>
    i.description || i.reference || t("unnamed");
}
