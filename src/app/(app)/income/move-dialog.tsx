"use client";

// "Ge till verksamhet": the lines picked on a day and whose sales they were (e.g. Sexmästeriet's beer rung up
// without its prefix lands in the reserv). The server gives them the cost centre that verksamhet's routing
// would have (lib/income/lines.ts). The account cannot be worked out, so the destination's own accounts go on top.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import type { IncomeLineRow, IncomeMoveTarget } from "@/lib/data/income";
import { productDisplayName } from "@/lib/income/product-groups";
import type { AccountRecord } from "@/lib/domain/types";

export interface AssignRequest {
  lines: { id: string; resultUnitId: string; account?: string }[];
}

/** What the picker should start on for a destination: its single account if it has exactly one, else the line keeps the fallback's (visibly wrong, so it reads as "choose"). */
function suggestedAccount(target: IncomeMoveTarget | undefined, current: string): string {
  if (target?.accounts.length === 1) return target.accounts[0].account;
  return current;
}

/** The accounts to offer for a line: the verksamhet's own first, then the rest of the chart. Used by the dialog and the review table's account column. */
export function accountOptions(
  unit: IncomeMoveTarget | undefined,
  accounts: AccountRecord[],
  unknownName: string,
): ComboOption[] {
  const own = (unit?.accounts ?? []).map((a) => ({
    value: a.account,
    label: `${a.account} - ${a.accountName || unknownName}${
      a.prefixes.length ? ` (${a.prefixes.join(", ")})` : ""
    }`,
    short: a.account,
  }));
  const ownNumbers = new Set(own.map((o) => o.value));
  return [
    ...own,
    ...accounts
      .filter((a) => !ownNumbers.has(a.number))
      .map((a) => ({ value: a.number, label: `${a.number} - ${a.name}`, short: a.number })),
  ];
}

export function MoveLinesDialog({
  lines,
  targets,
  accounts,
  busy,
  onCancel,
  onMove,
}: {
  lines: IncomeLineRow[];
  targets: IncomeMoveTarget[];
  accounts: AccountRecord[];
  busy: boolean;
  onCancel: () => void;
  onMove: (request: AssignRequest) => void;
}) {
  const t = useTranslations("income.move");
  const tLines = useTranslations("income.lines");

  // Never the day's own unit (the route refuses it), and not the verksamhet every picked line already has.
  const current = new Set(lines.map((l) => l.resultUnitId));
  const only = current.size === 1 ? [...current][0] : null;
  const choices = targets.filter((u) => u.resultUnitId !== only);
  const from = [...new Set(lines.map((l) => l.unitName ?? "-"))].join(", ");

  const [toResultUnitId, setToResultUnitId] = useState("");
  const target = choices.find((u) => u.resultUnitId === toResultUnitId);

  // Only what has been picked by hand, for the destination it was picked under; the account shown is
  // otherwise derived, so a new destination re-suggests. State keyed by destination, not reset in an effect.
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

  const unitOptions: ComboOption[] = choices.map((u) => ({
    value: u.resultUnitId,
    label: u.name,
  }));

  const options = accountOptions(target, accounts, t("unknownAccountName"));

  const total = lines.reduce((sum, l) => sum + l.total, 0);
  // Whether anything still sits on the fallback's account: not a blocker, but the mistake this screen exists to prevent.
  const unchanged = lines.filter((l) => accountFor(l) === l.account).length;

  return (
    <Modal label={t("title")} onClose={onCancel} className="max-w-3xl">
      <ModalHeader title={t("title")} subtitle={t("subtitle", { count: lines.length, from })} />

      <ModalBody>
        <Field label={t("destination")} hint={t("destinationHint")} requirement="required">
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
                className="rounded-control border border-border px-3 py-1 font-mono text-xs transition hover:border-accent hover:text-accent"
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

        <div className="overflow-x-auto rounded-panel border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs text-muted">
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
                      aria-label={t("accountFor", {
                        product: productDisplayName(line),
                      })}
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

      <ModalFooter blocker={target ? null : t("destinationRequired")}>
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
                lines: lines.map((l) => ({
                  id: l.id,
                  resultUnitId: target.resultUnitId,
                  // Only when it is a change: sending the line's own account would make the route rewrite the denormalised `accountName`.
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
