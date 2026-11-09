"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/ui/utils";
import type { ReceiptViewerProps } from "./receipt-viewer-impl";

export type { ViewerDocument } from "./receipt-viewer-impl";

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
  return (
    <div className={cn("relative overflow-hidden bg-surface", props.className)}>
      <Impl {...props} className="h-full w-full" />
    </div>
  );
}
