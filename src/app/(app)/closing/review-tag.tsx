"use client";

import { useTranslations } from "next-intl";
import { Tag } from "@/components/ui/status-pill";
import type { ReviewState, ReviewStatus } from "@/lib/closing/review";

const TONE: Record<ReviewStatus, "success" | "warning" | "danger"> = {
  OK: "success",
  QUESTION: "warning",
  REMARK: "danger",
};

/** Where a voucher stands in one pass of the review, in a word or two. */
export function ReviewTag({ state, size = "md" }: { state: ReviewState; size?: "sm" | "md" }) {
  const t = useTranslations("closing.review.status");
  if (state.state === "unreviewed") {
    return (
      <Tag tone="neutral" size={size}>
        {t("unreviewed")}
      </Tag>
    );
  }
  if (state.state === "changed") {
    return (
      <Tag tone="purple" size={size} title={t("changedHint")}>
        {t("changed")}
      </Tag>
    );
  }
  return (
    <Tag tone={TONE[state.review.status]} size={size}>
      {t(state.review.status)}
    </Tag>
  );
}
