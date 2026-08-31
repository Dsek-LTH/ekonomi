"use client";

// Client-only wrapper around the receipt viewer. pdf.js (used inside) touches
// browser globals at import time, so the implementation must never be evaluated
// during SSR. `ssr: false` guarantees that and keeps pdfjs out of the server
// bundle. Consumers import { ReceiptViewer } from here as usual.
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/ui/utils";
import type { ReceiptViewerProps } from "./receipt-viewer-impl";

export type { ViewerDocument } from "./receipt-viewer-impl";

// pdf.js is a large chunk, fetched at the moment someone first opens a receipt.
// This used to render nothing at all, so the panel read as an empty box rather
// than as one filling up.
function ViewerLoading() {
  const t = useTranslations("common");
  return (
    <div role="status" className="flex h-full w-full items-center justify-center">
      <Spinner size="lg" className="text-muted" />
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}

const Impl = dynamic(() => import("./receipt-viewer-impl"), {
  ssr: false,
  loading: ViewerLoading,
});

export function ReceiptViewer(props: ReceiptViewerProps) {
  // Reserve the viewer's box (height/border from `className`) while the client
  // chunk loads, to avoid layout shift; the impl fills it.
  return (
    <div className={cn("relative overflow-hidden bg-surface/40", props.className)}>
      <Impl {...props} className="h-full w-full" />
    </div>
  );
}
