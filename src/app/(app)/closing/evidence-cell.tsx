"use client";

import { useTranslations } from "next-intl";
import { Tag } from "@/components/ui/status-pill";
import type { VoucherEvidence } from "@/lib/closing/evidence";
import { useFormat } from "@/lib/ui/use-format";

/** What underlag the app holds for a voucher, in a few words. */
export function EvidenceTag({ evidence }: { evidence: VoucherEvidence }) {
  const t = useTranslations("closing.evidence");
  const { date } = useFormat();

  if (evidence.kind === "none") return <Tag tone="neutral">{t("none")}</Tag>;
  if (!evidence.agrees) {
    return (
      <Tag tone="danger" title={t("disagreesHint")}>
        {t("disagrees")}
      </Tag>
    );
  }
  if (evidence.kind === "income") {
    return <Tag tone="blue">{t("income", { date: date(evidence.date) })}</Tag>;
  }
  return (
    <Tag tone="success">
      {evidence.reference ? t("expense", { reference: evidence.reference }) : t("expenseNoRef")}
    </Tag>
  );
}
