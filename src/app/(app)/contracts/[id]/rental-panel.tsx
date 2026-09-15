"use client";

// The uthyrning half of a contract, as two cards that behave differently.
//
// Utrustning is what the *agreement* says: the gear and what it comes to. It is
// changed on the edit page until the signed copy is uploaded, and frozen after,
// because the renter has put their name to a document by then.
//
// Uthämtning och återlämning is what actually *happened*: the gear's condition
// going out and coming back, and when it was accepted. That stays editable
// forever, because it is a record of events rather than a term of the deal.
//
// They were one card, with the dates, the signatures and the rent listed above
// the table as well. That put three subjects under one heading and the period
// on the page twice. The facts are on the status card now (status-strip.tsx).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/ui/amount";
import { DateInput, Field, Textarea } from "@/components/ui/field";
import { useMutation } from "@/components/shell/use-mutation";
import { useFormat } from "@/lib/ui/use-format";
import { oreToSEK } from "@/lib/domain/money";
import { linePricing } from "@/lib/contract/rental/pricing";
import { isCompleteDate } from "@/lib/domain/date";
import { cn } from "@/lib/ui/utils";
import type { RentalDetailRow } from "@/lib/data/contracts";
import { Fact, Facts } from "./facts";

/** The gear on the contract, and what it comes to. */
export function RentalLinesCard({ rental }: { rental: RentalDetailRow }) {
  const t = useTranslations("contracts");

  const anyDiscount = rental.lines.some((l) => l.discountPercent > 0);
  const totalReplacement = rental.lines.reduce(
    (sum, l) => sum + l.replacementValueOre * l.quantity,
    0,
  );
  const discounted = rental.discountOre > 0;

  return (
    <Card>
      <CardHeader title={t("rental.lines")} />
      <CardBody className="space-y-5">
        {/* The lines as the contract states them, in the columns the document
            uses. The discount column is drawn only where something was
            discounted: a column of dashes on the ordinary rental is a question
            asked of every reader and answered for none. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">{t("rental.description")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("rental.quantity")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("rental.unitPrice")}</th>
                {anyDiscount && (
                  <th className="py-2 pr-3 text-right font-medium">{t("rental.discount")}</th>
                )}
                <th className="py-2 pr-3 text-right font-medium">{t("rental.lineAmount")}</th>
                <th className="py-2 text-right font-medium">{t("rental.replacementValue")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rental.lines.map((l) => {
                const priced = linePricing(l);
                return (
                  <tr key={l.id}>
                    <td className="py-2 pr-3">{l.description}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.quantity}</td>
                    <td className="py-2 pr-3 text-right">
                      <Amount value={oreToSEK(l.unitPriceOre)} />
                    </td>
                    {anyDiscount && (
                      <td className="py-2 pr-3 text-right tabular-nums text-muted">
                        {priced.discountPercent > 0 ? `${priced.discountPercent} %` : "–"}
                      </td>
                    )}
                    <td className="py-2 pr-3 text-right">
                      <Amount value={oreToSEK(priced.netOre)} />
                    </td>
                    <td className="py-2 text-right">
                      <Amount value={oreToSEK(l.replacementValueOre)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* What the lines come to, set like the foot of an invoice under the
            column it is the sum of: the same block the rental form draws under
            its sheet, so the two read alike. */}
        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-2.5">
            {discounted && (
              <>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted">{t("rental.subtotal")}</span>
                  <Amount value={oreToSEK(rental.subtotalOre)} />
                </div>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted">{t("rental.discount")}</span>
                  <span className="text-muted">
                    <Amount value={-oreToSEK(rental.discountOre)} />
                  </span>
                </div>
              </>
            )}
            <div
              className={cn(
                "flex items-baseline justify-between gap-3",
                discounted && "border-t border-border pt-2.5",
              )}
            >
              <span className="text-sm font-medium">{t("rental.price")}</span>
              <span className="font-semibold">
                <Amount value={oreToSEK(rental.priceOre)} />
              </span>
            </div>
            {totalReplacement > 0 && (
              <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
                <span>{t("rental.totalReplacement")}</span>
                <Amount value={oreToSEK(totalReplacement)} />
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/** What happened to the gear: its condition going out and coming back, and
 *  when it came back and was accepted. */
export function RentalRecordCard({
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

  // Whether the gear has been accepted, under the heading, because it is the
  // one line of this card somebody glances at without meaning to change it.
  const checked = rental.checkedAt
    ? rental.checkedBy
      ? t("rental.checkedBy", { name: rental.checkedBy })
      : undefined
    : t("rental.notChecked");

  return (
    <Card>
      <CardHeader
        title={t("rental.record")}
        subtitle={checked}
        action={
          canManage ? (
            <Button size="sm" onClick={settle} loading={pending === "settle"}>
              {t("rental.settle")}
            </Button>
          ) : undefined
        }
      />
      {/* The two condition notes lead. They are the half that actually
          settles a damage claim: without the first one, "it is broken" is an
          observation, and with it, it is a difference. See the villkor in
          rental/terms.ts. */}
      {canManage ? (
        <CardBody className="@container space-y-4">
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
          <div className="grid gap-4 @md:grid-cols-2">
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
        </CardBody>
      ) : (
        <CardBody>
          <Facts>
            <Fact label={t("rental.conditionOut")}>
              <span className="whitespace-pre-line">{rental.conditionOut ?? "–"}</span>
            </Fact>
            <Fact label={t("rental.conditionIn")}>
              <span className="whitespace-pre-line">{rental.conditionIn ?? "–"}</span>
            </Fact>
            <Fact label={t("rental.returnedAt")}>
              {rental.returnedAt ? date(rental.returnedAt) : "–"}
            </Fact>
            <Fact label={t("rental.checkedAt")}>
              {rental.checkedAt ? date(rental.checkedAt) : "–"}
            </Fact>
          </Facts>
        </CardBody>
      )}
    </Card>
  );
}

/** An ISO instant as the day a date field holds, or "" for none. */
const isoDay = (iso: string | null): string => iso?.slice(0, 10) ?? "";
