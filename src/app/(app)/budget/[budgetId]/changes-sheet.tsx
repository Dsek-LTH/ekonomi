// The editorial history of a locked budget, and the form that adds
// to it. See BudgetChange in schema.prisma for what a change is, and
// lib/budget/changes.ts for the rules — the form checks with the same function
// the API does, so the button is disabled for exactly the reasons the server
// would refuse.
//
// Everyone who can see the budget sees this view; only the treasurer sees the
// form, and only while the budget is locked. The figures are already adjusted
// wherever they appear — this is where it says who did it and why.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { EmptyNote } from "@/components/ui/empty-state";
import { Field, FieldGroup, Input, Textarea } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useConfirm } from "@/components/confirm-dialog";
import { effectiveKind, sheetName } from "@/lib/budget";
import {
  netResultImpact,
  parseAmount,
  scopeKey,
  scopeLabel,
  validateChange,
  type ChangeKind,
  type ResolvedEntry,
} from "@/lib/budget/changes";

import type { AccountRecord } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import { fmtSigned } from "./budget-helpers";
import type { ApiFn, Budget, BudgetCC, BudgetChange } from "./budget-types";

// One row of the form. The account is named by sheet + code rather than by id,
// because a change may fund a post the sheet doesn't budget for yet — then there
// is no id, and the API creates the account as part of the change.
interface DraftRow {
  key: string;
  costCenterId: string;
  accountCode: string;
  amount: string;
}

const emptyRow = (costCenterId = ""): DraftRow => ({
  key: Math.random().toString(36).slice(2),
  costCenterId,
  accountCode: "",
  amount: "",
});

export function ChangesSheet({ budget, budgetId, canChange, chart, api }: {
  budget: Budget;
  budgetId: string;
  /** The treasurer, on a locked budget — see canChangeLockedBudget. */
  canChange: boolean;
  /** The synced BAS chart, for funding an account the sheet doesn't hold yet. */
  chart: AccountRecord[];
  api: ApiFn;
}) {
  const t = useTranslations("budget.changes");
  // Under `errors` because the API returns these same verdicts as error codes,
  // and `resolveApiError` resolves them there — see lib/budget/changes.ts.
  const tError = useTranslations("errors.budget.changeError");
  const tSheet = useTranslations("budget.sheet");
  const tAlloc = useTranslations("allocation");
  const tCommon = useTranslations("common");
  const tBook = useTranslations("book");
  const confirm = useConfirm();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ChangeKind>("AVSTEG");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([emptyRow(), emptyRow()]);
  const [saving, setSaving] = useState(false);

  const sheets = budget.costCenters;
  const sheetById = new Map(sheets.map((cc) => [cc.id, cc]));
  // Searchable rather than a plain select: a budget carries every cost centre
  // the section has, and the code is what the treasurer knows one by.
  const sheetOptions = sheets.map((cc) => ({
    value: cc.id,
    label: cc.costCenter ? `${cc.costCenter.code} · ${cc.costCenter.name}` : sheetName(cc, tSheet("unnamed")),
    short: cc.costCenter?.code ?? sheetName(cc, tSheet("unnamed")),
  }));

  // Newest first: this is a log, and the last thing that happened is the thing
  // being looked for. The running numbers count the other way, which is what
  // makes it obvious that none are missing.
  const history = [...budget.changes].reverse();
  const active = budget.changes.filter((c) => c.revokedAt == null);

  // The draft, resolved far enough to be checked: rows still being filled in
  // are left out rather than counted as zero, so the
  // running total doesn't lurch while someone is typing.
  const filled = rows.filter((r) => r.costCenterId && r.accountCode && r.amount.trim() !== "");
  const resolved: ResolvedEntry[] = filled.flatMap((r) => {
    const sheet = sheetById.get(r.costCenterId);
    if (!sheet) return [];
    const existing = sheet.accounts.find((a) => a.accountCode === r.accountCode);
    return [{
      // The id only has to be stable and unique within the draft — the API
      // resolves the real one — and for an account that doesn't exist yet there
      // isn't one to use.
      accountId: existing?.id ?? `${sheet.id}:${r.accountCode}`,
      amount: parseAmount(r.amount),
      kind: effectiveKind(r.accountCode, existing?.kindOverride ?? null),
      scope: scopeKey(sheet),
      scopeLabel: scopeLabel(sheet, sheetName(sheet, tSheet("unnamed"))),
    }];
  });

  const net = netResultImpact(resolved.filter((e) => Number.isFinite(e.amount)));
  const check = validateChange(kind, resolved);
  const canSave = check.ok && reason.trim() !== "" && !saving;

  function setRow(key: string, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function reset() {
    setOpen(false);
    setKind("AVSTEG");
    setReason("");
    setRows([emptyRow(), emptyRow()]);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const ok = await api(`/api/budgets/${budgetId}/changes`, "POST", {
      kind,
      reason: reason.trim(),
      entries: filled.map((r) => ({
        costCenterId: r.costCenterId,
        accountCode: r.accountCode,
        amount: r.amount.trim(),
      })),
    });
    setSaving(false);
    if (ok) reset();
  }

  async function revoke(change: BudgetChange) {
    const ok = await confirm({
      title: t("revokeTitle", {
        label: t("label", { kind: change.kind, seq: change.seq }).toLowerCase(),
      }),
      message: t("revokeMessage"),
      confirmLabel: t("revoke"),
      tone: "danger",
    });
    if (!ok) return;
    await api(`/api/budget-changes/${change.id}`, "DELETE");
  }

  // What all the changes in force have done to the guild's bottom line. A
  // transfer contributes nothing here by construction — this is the deviation
  // total, arrived at rather than asserted.
  const totalImpact = netResultImpact(
    active.flatMap((c) =>
      c.entries.flatMap((e) => {
        const found = findAccount(sheets, e.accountId);
        return found ? [{ kind: found.kind, amount: e.amount }] : [];
      }),
    ),
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("title")}
          subtitle={
            active.length === 0
              ? t("unchanged")
              : t("summary", {
                  count: active.length,
                  effect:
                    totalImpact === 0
                      ? t("frameUnchanged")
                      : t("frameChangedBy", { amount: fmtSigned(totalImpact) }),
                })
          }
          action={
            canChange && !open ? (
              <Button size="sm" onClick={() => setOpen(true)}>
                <IconPlus className="size-4" /> {t("new")}
              </Button>
            ) : undefined
          }
        />

        {/* What the two kinds are, said once, where the decision is made. */}
        <div className="px-inset py-4 text-sm text-muted">
          <p>
            {t.rich("explainer", {
              strong: (chunks) => <strong className="font-medium text-foreground">{chunks}</strong>,
            })}
          </p>
        </div>

        {open && (
          <div className="border-t border-border px-inset py-4">
            <div className="space-y-4">
              <FieldGroup label={t("kindLabel")}>
                <SegmentedControl<ChangeKind>
                  options={[
                    { value: "AVSTEG", label: t("kind.AVSTEG") },
                    { value: "FORFLYTTNING", label: t("kind.FORFLYTTNING") },
                  ]}
                  value={kind}
                  onChange={setKind}
                />
                <p className="mt-1.5 text-xs text-muted">
                  {t(kind === "AVSTEG" ? "kindHint.AVSTEG" : "kindHint.FORFLYTTNING")}
                </p>
              </FieldGroup>

              <Field label={t("reason")} hint={t("reasonHint")}>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("reasonPlaceholder")}
                />
              </Field>

              <FieldGroup label={t("entries")}>
                <div className="space-y-2">
                  {rows.map((row) => {
                    const sheet = sheetById.get(row.costCenterId);
                    const known = sheet?.accounts.some((a) => a.accountCode === row.accountCode);
                    return (
                      <div key={row.key} className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1 basis-56">
                          <Combobox
                            options={sheetOptions}
                            value={row.costCenterId}
                            // The account code belongs to the sheet it was
                            // picked in, so changing the sheet clears it rather
                            // than carrying a code the new one may not hold.
                            onChange={(v) => setRow(row.key, { costCenterId: v, accountCode: "" })}
                            placeholder={t("costCenterPlaceholder")}
                            searchPlaceholder={tAlloc("search")}
                            emptyText={t("noSheets")}
                            aria-label={tAlloc("costCenter")}
                          />
                        </div>

                        <div className="min-w-0 flex-1 basis-56">
                          <Combobox
                            options={accountOptions(sheet, chart, t("notOnSheet"))}
                            value={row.accountCode}
                            onChange={(v) => setRow(row.key, { accountCode: v })}
                            placeholder={t("entryPlaceholder")}
                            searchPlaceholder={tBook("accountSearch")}
                            emptyText={chart.length ? t("noAccounts") : tSheet("emptyChart")}
                            aria-label={t("entry")}
                          />
                          {/* Funding a post the sheet doesn't hold is allowed —
                              but it is a thing to know you are doing. */}
                          {row.accountCode && sheet && !known && (
                            <p className="mt-1 text-xs text-warning">{t("willBeAdded", { sheet: sheetName(sheet, tSheet("unnamed")) })}</p>
                          )}
                        </div>

                        <Input
                          size="sm"
                          value={row.amount}
                          onChange={(e) => setRow(row.key, { amount: e.target.value })}
                          placeholder={t("amountPlaceholder")}
                          inputMode="text"
                          className="w-32 shrink-0 text-right font-mono"
                          aria-label={tAlloc("amountPlaceholder")}
                        />

                        <IconButton
                          tone="danger"
                          label={tAlloc("removeRow")}
                          onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== row.key) : rs))}
                        >
                          <IconTrash className="size-4" />
                        </IconButton>
                      </div>
                    );
                  })}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => setRows((rs) => [...rs, emptyRow(rs[rs.length - 1]?.costCenterId ?? "")])}
                >
                  <IconPlus className="size-4" /> {t("addEntry")}
                </Button>
              </FieldGroup>

              {/* The running verdict: what this would do to the frame budget,
                  and — when it can't be saved — the one reason why not, in the
                  same words the API would answer with. */}
              <div className="rounded-xl border border-border bg-surface/50 px-4 py-3 text-sm">
                <p>
                  {t("effectOnFrame")}{" "}
                  <span className={cn("font-semibold tabular-nums", net !== 0 && (net > 0 ? "text-success" : "text-danger"))}>
                    {resolved.length === 0 ? "—" : `${fmtSigned(net)} kr`}
                  </span>
                </p>
                {!check.ok && resolved.length > 0 && (
                  <p className="mt-1 text-xs text-danger">{tError(check.error, check.values)}</p>
                )}
                {check.ok && reason.trim() === "" && (
                  <p className="mt-1 text-xs text-muted">{t("reasonRequired")}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={save} loading={saving} disabled={!canSave}>
                  {t("save")}
                </Button>
                <Button variant="secondary" onClick={reset}>{tCommon("cancel")}</Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {history.length === 0 ? (
        <Card>
          <EmptyNote size="page">{t("empty")}</EmptyNote>
        </Card>
      ) : (
        <div className="space-y-3">
          {history.map((change) => (
            <ChangeCard
              key={change.id}
              change={change}
              sheets={sheets}
              canRevoke={canChange && change.revokedAt == null}
              onRevoke={() => revoke(change)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One change, as it stands in the history. A revoked one is shown in full and
// struck through: it is part of what happened, and hiding it would leave a gap
// in the numbering with nothing to explain it.
function ChangeCard({ change, sheets, canRevoke, onRevoke }: {
  change: BudgetChange;
  sheets: BudgetCC[];
  canRevoke: boolean;
  onRevoke: () => void;
}) {
  const t = useTranslations("budget.changes");
  const { date } = useFormat();
  const revoked = change.revokedAt != null;
  const entries = change.entries.map((e) => ({ ...e, found: findAccount(sheets, e.accountId) }));
  const impact = netResultImpact(
    entries.flatMap((e) => (e.found ? [{ kind: e.found.kind, amount: e.amount }] : [])),
  );

  return (
    <Card className={cn(revoked && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-inset py-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className={cn("font-semibold", revoked && "line-through")}>
              {t("label", { kind: change.kind, seq: change.seq })}
            </span>
            {revoked && (
              <span className="rounded-lg bg-surface px-2 py-0.5 text-xs font-medium text-muted">{t("revoked")}</span>
            )}
            <span className="text-xs text-muted">
              {date(change.createdAt)} · {change.createdBy.name}
            </span>
          </p>
          <p className={cn("mt-1 text-sm", revoked ? "text-muted line-through" : "text-foreground")}>
            {change.reason}
          </p>
          {revoked && (
            <p className="mt-1 text-xs text-muted">
              {change.revokedBy
                ? t("revokedByOn", { name: change.revokedBy.name, date: date(change.revokedAt!) })
                : t("revokedOn", { date: date(change.revokedAt!) })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-right text-sm text-muted">
            {t("frameBudget")}{" "}
            <span className={cn("font-semibold tabular-nums", !revoked && impact !== 0 && (impact > 0 ? "text-success" : "text-danger"))}>
              {impact === 0 ? t("unchangedShort") : `${fmtSigned(impact)} kr`}
            </span>
          </span>
          {canRevoke && (
            <Button size="sm" variant="dangerOutline" onClick={onRevoke}>{t("revoke")}</Button>
          )}
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-border/50 last:border-0">
              <td className="px-inset py-1.5">
                {e.found ? e.found.sheetLabel : <span className="text-muted">{t("removedEntry")}</span>}
              </td>
              <td className="px-4 py-1.5 text-muted">
                {e.found ? `${e.found.accountCode} · ${e.found.accountName}` : ""}
              </td>
              <td className={cn("px-inset py-1.5 text-right tabular-nums", revoked && "line-through")}>
                {fmtSigned(e.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// Where an entry's account sits, for the history table. Returns null for an
// account the budget no longer holds — which the API refuses to let happen, but
// the view is not the place to insist on it.
function findAccount(sheets: BudgetCC[], accountId: string) {
  for (const cc of sheets) {
    const account = cc.accounts.find((a) => a.id === accountId);
    if (!account) continue;
    return {
      sheetLabel: cc.costCenter ? `${cc.costCenter.code} ${cc.costCenter.name}` : sheetName(cc),
      accountCode: account.accountCode,
      accountName: account.accountName,
      kind: effectiveKind(account.accountCode, account.kindOverride),
    };
  }
  return null;
}

// The accounts a row may name: the ones this sheet already budgets for first,
// since that is nearly always what is meant, then the rest of the chart for the
// case where a change funds something new.
function accountOptions(sheet: BudgetCC | undefined, chart: AccountRecord[], notOnSheet: string) {
  const own = (sheet?.accounts ?? []).map((a) => ({
    value: a.accountCode,
    label: `${a.accountCode} · ${a.accountName}`,
    short: a.accountCode,
  }));
  const taken = new Set(own.map((o) => o.value));
  const rest = chart
    .filter((a) => a.active && !taken.has(a.number))
    .map((a) => ({ value: a.number, label: `${a.number} · ${a.name} — ${notOnSheet}`, short: a.number }));
  return [...own, ...rest];
}
