"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/ui/amount";
import { DateInput, Field, Textarea } from "@/components/ui/field";
import { DetailList, DetailRow } from "@/components/ui/detail-list";
import { useMutation } from "@/components/shell/use-mutation";
import { useFormat } from "@/lib/ui/use-format";
import { oreToSEK } from "@/lib/domain/money";
import { isCompleteDate } from "@/lib/domain/date";
import type { RentalDetailRow } from "@/lib/data/contracts";

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
  rental,
  canManage,
}: {
  contractId: string;
  rental: RentalDetailRow;
  canManage: boolean;
}) {
  const t = useTranslations("contracts");
  const { mutate, pending } = useMutation();
  const { date } = useFormat();

  const [returnedAt, setReturnedAt] = useState(isoDay(rental.returnedAt));
  const [checkedAt, setCheckedAt] = useState(isoDay(rental.checkedAt));
  const [conditionOut, setConditionOut] = useState(rental.conditionOut ?? "");
  const [conditionIn, setConditionIn] = useState(rental.conditionIn ?? "");

  const totalReplacement = rental.lines.reduce(
    (sum, l) => sum + l.replacementValueOre * l.quantity,
    0,
  );

  // An emptied field clears the column; a half-typed date is left alone, which
  // is what `undefined` means to the patch schema.
  const dateField = (v: string) => (v === "" ? null : isCompleteDate(v) ? v : undefined);

  async function settle() {
    await mutate(`/api/contracts/${contractId}/rental/record`, {
      method: "PATCH",
      body: {
        returnedAt: dateField(returnedAt),
        checkedAt: dateField(checkedAt),
        conditionOut: conditionOut.trim() || null,
        conditionIn: conditionIn.trim() || null,
      },
      key: "settle",
      success: t("rental.settled"),
    });
  }

  return (
    <Card>
      {/* No action here. Redrawing the document is the contract's action, not
          this card's, and it lives in the one group on the status card with
          everything else you can do to the contract. It was in both places,
          which is the scattering that group exists to end. */}
      <CardHeader title={t("kind.RENTAL")} />
      <CardBody className="space-y-5">
        <DetailList>
          <DetailRow label={t("rental.pickupAt")} value={date(rental.pickupAt)} />
          <DetailRow label={t("rental.returnAt")} value={date(rental.returnAt)} />
          {rental.place && <DetailRow label={t("rental.place")} value={rental.place} />}
          {rental.discountOre > 0 && (
            <>
              <DetailRow
                label={t("rental.subtotal")}
                value={<Amount value={oreToSEK(rental.subtotalOre)} />}
              />
              <DetailRow
                label={t("rental.discount")}
                value={<Amount value={-oreToSEK(rental.discountOre)} />}
              />
            </>
          )}
          <DetailRow
            label={t("rental.price")}
            value={<Amount value={oreToSEK(rental.priceOre)} />}
          />
        </DetailList>

        {rental.purpose && (
          <div>
            <p className="text-xs font-medium text-muted">{t("rental.purpose")}</p>
            <p className="mt-1 whitespace-pre-line break-words text-sm">{rental.purpose}</p>
          </div>
        )}

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
            contract's status: the gear coming back is not a term of the deal.

            The two condition notes are the half that actually settles a damage
            claim. Without the first one, "it is broken" is an observation; with
            it, it is a difference. See the villkor in rental/terms.ts. */}
        {canManage ? (
          <div className="space-y-4 rounded-xl border border-dashed border-border p-4">
            <h3 className="text-sm font-medium">{t("rental.record")}</h3>
            <Field
              label={t("rental.conditionOut")}
              hint={t("rental.conditionOutHint")}
              requirement="optional"
            >
              <Textarea
                value={conditionOut}
                onChange={(e) => setConditionOut(e.target.value)}
                maxLength={2000}
              />
            </Field>
            <Field
              label={t("rental.conditionIn")}
              hint={t("rental.conditionInHint")}
              requirement="optional"
            >
              <Textarea
                value={conditionIn}
                onChange={(e) => setConditionIn(e.target.value)}
                maxLength={2000}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("rental.returnedAt")} requirement="optional">
                <DateInput value={returnedAt} onChange={(e) => setReturnedAt(e.target.value)} />
              </Field>
              <Field
                label={t("rental.checkedAt")}
                hint={t("rental.checkedAtHint")}
                requirement="optional"
              >
                <DateInput value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">
                {rental.checkedAt
                  ? rental.checkedBy
                    ? t("rental.checkedBy", { name: rental.checkedBy })
                    : ""
                  : t("rental.notChecked")}
              </span>
              <Button size="sm" onClick={settle} loading={pending === "settle"}>
                {t("rental.settle")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Prose, not label/value rows. Each note runs to 2000 characters,
                and a right-aligned cell opposite a label is built for a date.
                They lead here because they are what a damage claim rests on. */}
            {(rental.conditionOut || rental.conditionIn) && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-muted">{t("rental.conditionOut")}</p>
                  <p className="mt-1 whitespace-pre-line break-words text-sm">
                    {rental.conditionOut ?? "–"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted">{t("rental.conditionIn")}</p>
                  <p className="mt-1 whitespace-pre-line break-words text-sm">
                    {rental.conditionIn ?? "–"}
                  </p>
                </div>
              </div>
            )}
            <DetailList>
              <DetailRow
                label={t("rental.returnedAt")}
                value={rental.returnedAt ? date(rental.returnedAt) : "–"}
              />
              <DetailRow
                label={t("rental.checkedAt")}
                value={
                  rental.checkedAt
                    ? `${date(rental.checkedAt)}${
                        rental.checkedBy ? ` (${rental.checkedBy})` : ""
                      }`
                    : t("rental.notChecked")
                }
              />
            </DetailList>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** An ISO instant as the day a date field holds, or "" for none. */
const isoDay = (iso: string | null): string => iso?.slice(0, 10) ?? "";
