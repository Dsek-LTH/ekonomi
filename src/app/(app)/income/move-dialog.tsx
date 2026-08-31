"use client";

// "Flytta försäljning": the lines picked on one verksamhet's day, and where
// they are going.
//
// The case it exists for: Sexmästeriet's beer rung up without its prefix routes
// to the fallback, Skattmästeriet, while the beer that was rung up properly
// sits in Sexmästeriet's own report for the same day. Two reports, one day's
// takings. This moves the strays across so there is one report to book, one
// intäktsräkning and one verifikation.
//
// The account is the part that cannot be worked out for anyone. A line in the
// fallback got there by having no prefix, and intakt strips the prefix off the
// name of every line that does have one, so the row carries no trace of which
// of the destination's accounts it belongs to. What this can do is put the
// destination's own accounts at the top of the picker and set them all at once,
// which turns thirty mis-sold beers into one choice rather than thirty.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import type { IncomeLineRow, IncomeMoveTarget, IncomeReportRow } from "@/lib/data/income";
import { productDisplayName } from "@/lib/income/product-groups";
import type { AccountRecord } from "@/lib/domain/types";

export interface MoveRequest {
  toResultUnitId: string;
  lines: { id: string; account?: string }[];
}

/**
 * What the picker should start on for a destination.
 *
 * One account among its prefixes means there is no question to ask. That is
 * where this unit's revenue goes. More than one, or none at all, and the line
 * keeps what it has: the fallback's account, which is visibly wrong and so
 * reads as "choose" rather than as an answer. Guessing between beer and food
 * here would produce a voucher that looks decided and is not.
 */
export function suggestedAccount(target: IncomeMoveTarget | undefined, current: string): string {
  if (target?.accounts.length === 1) return target.accounts[0].account;
  return current;
}

/**
 * The accounts to offer for a line: the verksamhet's own first, named by the
 * prefixes that route to them, then the rest of the chart.
 *
 * Both places that let someone choose an account for a sale use this: the
 * dialog below, and the account column of the review screen's own table. An
 * account is an account, so the whole chart is offered; a unit's own are put in
 * front because they are what the answer nearly always is.
 */
export function accountOptions(
  unit: IncomeMoveTarget | undefined,
  accounts: AccountRecord[],
  unknownName: string,
): ComboOption[] {
  const own = (unit?.accounts ?? []).map((a) => ({
    value: a.account,
    label: `${a.account} – ${a.accountName || unknownName}${
      a.prefixes.length ? ` (${a.prefixes.join(", ")})` : ""
    }`,
    short: a.account,
  }));
  const ownNumbers = new Set(own.map((o) => o.value));
  return [
    ...own,
    ...accounts
      .filter((a) => !ownNumbers.has(a.number))
      .map((a) => ({ value: a.number, label: `${a.number} – ${a.name}`, short: a.number })),
  ];
}

export function MoveLinesDialog({
  report,
  lines,
  targets,
  accounts,
  busy,
  onCancel,
  onMove,
}: {
  /** The day the lines are leaving. */
  report: IncomeReportRow;
  lines: IncomeLineRow[];
  targets: IncomeMoveTarget[];
  /** The chart, for the accounts the destination's own prefixes do not cover. */
  accounts: AccountRecord[];
  busy: boolean;
  onCancel: () => void;
  onMove: (request: MoveRequest) => void;
}) {
  const t = useTranslations("income.move");
  const tLines = useTranslations("income.lines");

  // Never the day's own unit: moving lines to where they already are is not a
  // move, and the route refuses it.
  const choices = targets.filter((u) => u.resultUnitId !== report.resultUnitId);

  const [toResultUnitId, setToResultUnitId] = useState("");
  const target = choices.find((u) => u.resultUnitId === toResultUnitId);

  // Only what has been picked by hand, and only for the destination it was
  // picked under. The account shown is otherwise derived, so choosing a
  // different verksamhet re-suggests rather than leaving the last one's answer
  // sitting in a field: the suggestion is "this unit's account", so it means
  // nothing once the unit has changed. Held as state keyed by the destination
  // rather than reset in an effect. An effect would be a second render for
  // something that can just be read.
  const [override, setOverride] = useState<{ unitId: string; byLine: Record<string, string> }>({
    unitId: "",
    byLine: {},
  });
  const accountFor = (line: IncomeLineRow) =>
    (override.unitId === toResultUnitId ? override.byLine[line.id] : undefined) ??
    suggestedAccount(target, line.account);
  const setAccountFor = (byLine: Record<string, string>) =>
    setOverride({ unitId: toResultUnitId, byLine });
  const setOneAccount = (lineId: string, account: string) =>
    setOverride((o) => ({
      unitId: toResultUnitId,
      byLine: { ...(o.unitId === toResultUnitId ? o.byLine : {}), [lineId]: account },
    }));

  const unitOptions: ComboOption[] = choices.map((u) => ({ value: u.resultUnitId, label: u.name }));

  const options = accountOptions(target, accounts, t("unknownAccountName"));

  const total = lines.reduce((sum, l) => sum + l.total, 0);
  // Whether anything is still sitting on the account it had in the fallback.
  // Not a blocker: a line may genuinely belong on it, but it is the mistake
  // this screen exists to prevent, so it is said out loud.
  const unchanged = lines.filter((l) => accountFor(l) === l.account).length;

  return (
    <Modal label={t("title")} onClose={onCancel} className="max-w-3xl">
      <ModalHeader
        title={t("title")}
        subtitle={t("subtitle", { count: lines.length, from: report.unitName ?? "" })}
      />

      <ModalBody>
        <Field label={t("destination")} hint={t("destinationHint")}>
          <Combobox
            options={unitOptions}
            value={toResultUnitId}
            onChange={setToResultUnitId}
            placeholder={t("destinationPlaceholder")}
            aria-label={t("destination")}
          />
        </Field>

        {target && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted">{t("setAll")}</span>
            {target.accounts.map((a) => (
              <button
                key={a.account}
                type="button"
                onClick={() =>
                  setAccountFor(Object.fromEntries(lines.map((l) => [l.id, a.account])))
                }
                aria-label={t("setAllTo", { account: a.account })}
                className="rounded-full border border-border px-3 py-1 font-mono text-xs transition hover:border-accent hover:text-accent"
              >
                {a.account}
                {a.prefixes.length > 0 && (
                  <span className="ml-1.5 font-sans text-muted">{a.prefixes.join(", ")}</span>
                )}
              </button>
            ))}
            {target.accounts.length === 0 && (
              <span className="text-xs text-muted">{t("noAccounts")}</span>
            )}
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface/40 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{tLines("product")}</th>
                <th className="px-3 py-2 font-medium">{t("account")}</th>
                <th className="px-3 py-2 text-right font-medium">{tLines("total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-3 py-2">
                    {/* The whole name, "Macka Ost", as the document writes it
                        and as the review table writes a row with no heading
                        above it. These lines have been lifted out of their day,
                        so there is nothing above them to lean on. */}
                    {productDisplayName(line)}
                    <span className="block text-xs text-muted">
                      {t("wasAccount", { account: line.account })}
                    </span>
                  </td>
                  <td className="w-56 px-3 py-2">
                    <Combobox
                      options={options}
                      value={accountFor(line)}
                      onChange={(v) => setOneAccount(line.id, v)}
                      disabled={!target}
                      aria-label={t("accountFor", { product: productDisplayName(line) })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Amount value={line.total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {target && unchanged > 0 && <Notice>{t("stillOnOldAccount", { count: unchanged })}</Notice>}
      </ModalBody>

      <ModalFooter>
        <span className="text-sm text-muted">
          {t("movingTotal")} <Amount value={total} />
        </span>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            loading={busy}
            disabled={!target || lines.length === 0}
            onClick={() =>
              target &&
              onMove({
                toResultUnitId: target.resultUnitId,
                lines: lines.map((l) => ({
                  id: l.id,
                  // Only when it is actually a change. Sending the line's own
                  // account back would have the route rewrite `accountName`
                  // from the chart as it stands today, which is exactly what
                  // the denormalised copy exists to avoid.
                  ...(accountFor(l) !== l.account ? { account: accountFor(l) } : {}),
                })),
              })
            }
          >
            {t("confirm", { count: lines.length })}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
