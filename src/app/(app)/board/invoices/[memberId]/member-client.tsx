"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconPlus } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";
import type { BoardMemberDto, BoardWithdrawalDto, ClosedTabDto } from "@/lib/data/board";
import type { BoardInvoicePreview } from "@/lib/server/board-invoices";

import { ClosedTabs, OpenTab, TabFacts } from "../../tab-view";
import type { ResendOptions } from "../../resend-dialog";
import { InvoiceDialog } from "../invoice-dialog";

export default function MemberClient({
  member,
  open,
  closed,
  preview,
  yearLabel,
  canManage,
  resend,
}: {
  member: BoardMemberDto;
  open: BoardWithdrawalDto[];
  closed: ClosedTabDto[];
  /** What invoicing this person now would make, for the picked year. Null when there is nothing to invoice. */
  preview: BoardInvoicePreview | null;
  yearLabel: string | null;
  /** The treasurer: may log for them, take back anything open, and invoice. */
  canManage: boolean;
  /** The accounts and cost centres an invoice can be sent again with. */
  resend: ResendOptions;
}) {
  const t = useTranslations("board");
  const [invoicing, setInvoicing] = useState(false);

  return (
    <PageShell
      title={member.name}
      subtitle={member.onBoard ? undefined : <Tag tone="warning">{t("members.left")}</Tag>}
      back="/board/invoices"
      width="content"
    >
      <div className="space-y-5">
        <TabFacts open={open} />
        <OpenTab
          open={open}
          mayRemove={() => canManage}
          empty={t("invoices.nothingOpen")}
          action={
            canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <ButtonLink href={`/board?member=${member.id}`} size="sm" variant="secondary">
                  <IconPlus className="size-4" />
                  {t("invoices.logForMember")}
                </ButtonLink>
                {/* For somebody leaving the board, when waiting for the year's end is not wanted. */}
                {preview && yearLabel && (
                  <Button size="sm" onClick={() => setInvoicing(true)}>
                    {t("invoice.now")}
                  </Button>
                )}
              </div>
            )
          }
        />
        <ClosedTabs closed={closed} resend={canManage ? resend : undefined} />
      </div>

      {invoicing && preview && yearLabel && (
        <InvoiceDialog year={yearLabel} members={[preview]} onClose={() => setInvoicing(false)} />
      )}
    </PageShell>
  );
}
