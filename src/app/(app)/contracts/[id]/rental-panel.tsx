"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/ui/amount";
import { DateInput, Field } from "@/components/ui/field";
import { DetailList, DetailRow } from "@/components/ui/detail-list";
import { useMutation } from "@/components/shell/use-mutation";
import { useFormat } from "@/lib/ui/use-format";
import { canEditRental } from "@/lib/contract/status";
import { oreToSEK } from "@/lib/domain/money";
import { isCompleteDate } from "@/lib/domain/date";
import type { RentalDetailRow } from "@/lib/data/contracts";
import type { ContractStatus } from "@/lib/domain/types";

/**
 * The uthyrning half of a contract.
 *
 * Two things live here that behave differently, and the split is the point.
 * Above the line is what the *agreement* says: the gear, the period, the price.
 * That is frozen once the contract leaves as a draft, because the counterparty
 * is reading a document by then. Below it is what actually *happened*: whether
 * the gear came back and whether the deposit went back. That stays editable
 * forever, because it is a record of events rather than a term of the deal.
 */
export function RentalPanel({
  contractId,
  status,
  rental,
  canManage,
}: {
  contractId: string;
  status: ContractStatus;
  rental: RentalDetailRow;
  canManage: boolean;
}) {
  const t = useTranslations("contracts");
  const { mutate, pending } = useMutation();
  const { date } = useFormat();

  const [returnedAt, setReturnedAt] = useState(isoDay(rental.returnedAt));
  const [depositReturnedAt, setDepositReturnedAt] = useState(isoDay(rental.depositReturnedAt));

  const totalReplacement = rental.lines.reduce(
    (sum, l) => sum + l.replacementValueOre * l.quantity,
    0,
  );

  async function settle() {
    await mutate(`/api/contracts/${contractId}/rental/return`, {
      method: "PATCH",
      body: {
        returnedAt: returnedAt === "" ? null : isCompleteDate(returnedAt) ? returnedAt : undefined,
        depositReturnedAt:
          depositReturnedAt === ""
            ? null
            : isCompleteDate(depositReturnedAt)
              ? depositReturnedAt
              : undefined,
      },
      key: "settle",
      success: t("rental.settled"),
    });
  }

  async function regenerate() {
    await mutate(`/api/contracts/${contractId}/document`, {
      key: "regenerate",
      success: t("rental.regenerated"),
    });
  }

  return (
    <Card>
      <CardHeader
        title={t("kind.RENTAL")}
        action={
          // Only while it is still a draft. After that the document has gone to
          // somebody, and redrawing it would leave two versions in the world
          // with nothing saying which one was signed.
          canManage && canEditRental(status) ? (
            <Button
              variant="secondary"
              size="sm"
              loading={pending === "regenerate"}
              onClick={regenerate}
            >
              {t("rental.regenerate")}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-5">
        <DetailList>
          <DetailRow label={t("rental.pickupAt")} value={date(rental.pickupAt)} />
          <DetailRow label={t("rental.returnAt")} value={date(rental.returnAt)} />
          {rental.purpose && <DetailRow label={t("rental.purpose")} value={rental.purpose} />}
          {rental.place && <DetailRow label={t("rental.place")} value={rental.place} />}
          <DetailRow
            label={t("rental.price")}
            value={<Amount value={oreToSEK(rental.priceOre)} />}
          />
          <DetailRow
            label={t("rental.deposit")}
            value={<Amount value={oreToSEK(rental.depositOre)} />}
          />
        </DetailList>

        <div>
          <h3 className="mb-2 text-sm font-medium">{t("rental.lines")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">{t("rental.description")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("rental.quantity")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("rental.unitPrice")}</th>
                  <th className="py-2 text-right font-medium">
                    {t("rental.replacementValue")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rental.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3">{l.description}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.quantity}</td>
                    <td className="py-2 pr-3 text-right">
                      <Amount value={oreToSEK(l.unitPriceOre)} />
                    </td>
                    <td className="py-2 text-right">
                      <Amount value={oreToSEK(l.replacementValueOre)} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <td className="py-2 pr-3" colSpan={3}>
                    {t("rental.totalReplacement")}
                  </td>
                  <td className="py-2 text-right">
                    <Amount value={oreToSEK(totalReplacement)} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* What happened, as against what was agreed. Editable whatever the
            contract's status: the gear coming back is not a term of the deal. */}
        {canManage ? (
          <div className="space-y-4 rounded-xl border border-dashed border-border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("rental.returnedAt")}>
                <DateInput value={returnedAt} onChange={(e) => setReturnedAt(e.target.value)} />
              </Field>
              <Field label={t("rental.depositReturnedAt")}>
                <DateInput
                  value={depositReturnedAt}
                  onChange={(e) => setDepositReturnedAt(e.target.value)}
                  // A deposit that was never taken has nothing to give back.
                  disabled={rental.depositOre === 0}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={settle} loading={pending === "settle"}>
                {t("rental.settle")}
              </Button>
            </div>
          </div>
        ) : (
          <DetailList>
            <DetailRow
              label={t("rental.returnedAt")}
              value={rental.returnedAt ? date(rental.returnedAt) : "–"}
            />
            <DetailRow
              label={t("rental.depositReturnedAt")}
              value={rental.depositReturnedAt ? date(rental.depositReturnedAt) : "–"}
            />
          </DetailList>
        )}
      </CardBody>
    </Card>
  );
}

/** An ISO instant as the day a date field holds, or "" for none. */
const isoDay = (iso: string | null): string => iso?.slice(0, 10) ?? "";
