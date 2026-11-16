"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import type { BoardInvoicePreview, BoardInvoiceRunResult } from "@/lib/server/board-invoices";

import { CustomerPicker, guessCustomer, useFortnoxCustomers } from "../customer-picker";
import { kr } from "../tab-view";

/**
 * What the run will do, member by member, before it does it, and the Fortnox customer each invoice goes to.
 * Then what it did.
 */
export function InvoiceDialog({
  year,
  members,
  onClose,
}: {
  year: string;
  members: BoardInvoicePreview[];
  onClose: () => void;
}) {
  const t = useTranslations("board");
  const { pending, mutate } = useMutation();
  const [result, setResult] = useState<BoardInvoiceRunResult | null>(null);
  const total = members.reduce((sum, m) => sum + m.totalOre, 0);
  const customers = useFortnoxCustomers();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const customerOf = (m: BoardInvoicePreview) =>
    picked[m.memberId] ?? guessCustomer(customers.list, { ...m, name: m.memberName });
  const allPicked = members.every((m) => customerOf(m));

  async function run() {
    const done = await mutate<BoardInvoiceRunResult>("/api/board/invoices", {
      body: {
        memberIds: members.map((m) => m.memberId),
        customers: Object.fromEntries(members.map((m) => [m.memberId, customerOf(m)])),
      },
      error: t("invoice.failed"),
    });
    if (done) setResult(done);
  }

  return (
    <Modal label={t("invoice.title", { year })} onClose={onClose} className="max-w-lg">
      <ModalHeader title={t("invoice.title", { year })} subtitle={t("invoice.hint")} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-inset py-4">
        {result ? (
          <div className="space-y-3 text-sm">
            {result.sent.length > 0 && (
              <div>
                <p className="font-medium">{t("invoice.sent", { count: result.sent.length })}</p>
                <ul className="mt-1 text-muted">
                  {result.sent.map((s) => (
                    <li key={s.documentNumber}>
                      {s.memberName}: {s.documentNumber}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.failed.length > 0 && (
              <div>
                <p className="font-medium text-warning">
                  {t("invoice.failedSome", { count: result.failed.length })}
                </p>
                <ul className="mt-1 text-muted">
                  {result.failed.map((f) => (
                    <li key={f.memberName}>
                      {f.memberName}: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          members.map((m) => (
            <div key={m.memberId}>
              <div className="flex items-baseline justify-between gap-3 text-sm font-medium">
                <span>{m.memberName}</span>
                <span className="tabular-nums">{kr(m.totalOre)}</span>
              </div>
              <div className="mt-1.5">
                <CustomerPicker
                  customers={customers}
                  value={customerOf(m)}
                  onChange={(v) => setPicked((p) => ({ ...p, [m.memberId]: v }))}
                  memberName={m.memberName}
                />
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {m.lines.map((l) => (
                  <li
                    key={`${l.description}|${l.unitPriceOre}`}
                    className="flex justify-between gap-3 tabular-nums"
                  >
                    <span>
                      {l.qty} x {l.description} ({kr(l.unitPriceOre)})
                    </span>
                    <span>{kr(l.amountOre)}</span>
                  </li>
                ))}
                {m.invoices
                  .filter((i) => !i.documentNumber)
                  .map((i) => (
                    <li key={i.id} className="text-warning">
                      {t("invoice.unsent", { amount: kr(i.totalOre) })}
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </div>
      <ModalFooter>
        {!result && <span className="text-sm font-medium tabular-nums">{kr(total)}</span>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {result ? t("invoice.close") : t("cancel")}
          </Button>
          {!result && (
            <Button onClick={run} disabled={!allPicked} loading={pending !== null}>
              {t("invoice.run", { count: members.length })}
            </Button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
}
