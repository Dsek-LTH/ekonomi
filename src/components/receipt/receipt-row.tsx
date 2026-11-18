"use client";

// The page's receipt on a phone, while its panel is folded away: a row under the title, as an attachment is shown in a
// mail, so the receipt reads as part of the page rather than a button. A thumbnail when it is a photo, what it is
// called, and "Visa", which opens the panel. From md the panel has its own tab on the right edge instead.
import { useTranslations } from "next-intl";
import { IconChevronRight, IconReceipt } from "@/components/ui/icons";
import {
  useOpenReceiptPanel,
  useReceiptDocuments,
  useReceiptTabShowing,
} from "@/components/receipt/receipt-panel";

export function ReceiptRow() {
  const t = useTranslations("receipt");
  const showing = useReceiptTabShowing();
  const docs = useReceiptDocuments();
  const open = useOpenReceiptPanel();
  if (!showing || !docs || docs.length === 0) return null;

  // The photo to show, if any: a drawn page (svg) or a PDF gets the receipt icon instead.
  const photo = docs.find((d) => d.mimeType.startsWith("image/") && !d.svg);
  const first = docs[0];
  const name =
    docs.length > 1
      ? t("count", { count: docs.length })
      : (first.filename ?? first.label ?? t("tab"));

  return (
    <button
      type="button"
      onClick={open}
      aria-label={t("expand")}
      className="mb-4 flex w-full items-center gap-3 rounded-panel border border-border bg-background p-2 text-left transition-colors hover:bg-hover md:hidden print:hidden"
    >
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface text-muted">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.src} alt="" className="size-full object-cover" />
        ) : (
          <IconReceipt className="size-5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted">{t("tab")}</span>
        <span className="block truncate text-sm font-medium">{name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-link">
        {t("show")}
        <IconChevronRight className="size-4" />
      </span>
    </button>
  );
}
