"use client";

import { useTranslations } from "next-intl";

import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { IconPlus } from "@/components/ui/icons";
import type { BoardWithdrawalDto, ClosedTabDto } from "@/lib/data/board";

import { ClosedTabs, OpenTab, TabFacts } from "../tab-view";

export default function HistoryClient({
  open,
  closed,
  canLog,
  canManage,
}: {
  open: BoardWithdrawalDto[];
  closed: ClosedTabDto[];
  /** Still on the board, so may log more. */
  canLog: boolean;
  /** The treasurer, who may take back anything not invoiced. */
  canManage: boolean;
}) {
  const t = useTranslations("board");
  return (
    <PageShell title={t("history.title")} width="content">
      <div className="space-y-5">
        <TabFacts open={open} />
        <OpenTab
          open={open}
          // A member takes their own back only the day it was written down.
          mayRemove={(w) => canManage || w.fresh}
          empty={t("history.nothingOpen")}
          action={
            canLog && (
              <ButtonLink href="/board" size="sm">
                <IconPlus className="size-4" />
                {t("history.logMore")}
              </ButtonLink>
            )
          }
        />
        <ClosedTabs closed={closed} />
      </div>
    </PageShell>
  );
}
