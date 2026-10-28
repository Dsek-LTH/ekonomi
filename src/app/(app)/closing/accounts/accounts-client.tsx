"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { useMutation } from "@/components/shell/use-mutation";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { Field, Textarea } from "@/components/ui/field";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls } from "@/lib/data/use-list-query";
import type { AccountNoteBody, ReconcileAccountBody } from "@/lib/api/schemas/closing";
import type { ClosingYear } from "@/lib/data/closing";
import type { BalanceAccount } from "@/lib/data/closing-checklist";
import { useFormat } from "@/lib/ui/use-format";
import { closingSections } from "../sections";

export default function AccountsClient({
  year,
  accounts,
  canWork,
}: {
  year: ClosingYear;
  accounts: BalanceAccount[];
  /** May mark accounts and write their notes. */
  canWork: boolean;
}) {
  const t = useTranslations("closing");
  const tAcc = useTranslations("closing.accounts");
  const { dateTime } = useFormat();
  const controls = useTableControls();

  const left = accounts.filter((a) => !a.reconciled).length;
  const tabs: ClientTabFilter<BalanceAccount> = [
    { value: "all", label: tAcc("tab.all") },
    { value: "open", label: tAcc("tab.open"), badge: left, predicate: (a) => !a.reconciled },
    { value: "done", label: tAcc("tab.done"), predicate: (a) => a.reconciled !== null },
  ];

  const columns: Column<BalanceAccount>[] = [
    {
      key: "account",
      header: tAcc("col.account"),
      mobile: "title",
      searchable: true,
      value: (a) => `${a.account} ${a.name}`,
      cell: (a) => (
        <span className="break-words">
          {a.account} - {a.name}
        </span>
      ),
    },
    {
      key: "opening",
      header: tAcc("col.opening"),
      align: "right",
      mobile: "meta",
      className: "whitespace-nowrap",
      cell: (a) => <Amount value={a.opening} />,
    },
    {
      key: "closing",
      header: tAcc("col.closing"),
      align: "right",
      mobile: "trailing",
      className: "whitespace-nowrap",
      cell: (a) => <Amount value={a.closing} />,
    },
    {
      key: "status",
      header: tAcc("col.status"),
      mobile: "status",
      cell: (a) =>
        a.reconciled ? (
          <Tag tone="success" title={tAcc("by", { name: a.reconciled.by ?? tAcc("someone"), when: dateTime(a.reconciled.at) })}>
            {tAcc("reconciled")}
          </Tag>
        ) : (
          <Tag tone="neutral">{tAcc("notReconciled")}</Tag>
        ),
    },
  ];

  return (
    <PageShell
      title={t("yearTitle", { year: year.year })}
      pages={closingSections({
        active: "accounts",
        label: t("sections.label"),
        labels: {
          checklist: t("sections.checklist"),
          vouchers: t("sections.vouchers"),
          accounts: t("sections.accounts"),
        },
      })}
    >
      <Card>
        <ClientDataTable
          columns={columns}
          rows={accounts}
          controls={controls}
          tabs={tabs}
          searchPlaceholder={tAcc("search")}
          rowKey={(a) => a.account}
          expansion={(a) => <AccountPanel yearId={year.id} account={a} canWork={canWork} />}
          empty={tAcc("empty")}
        />
      </Card>
    </PageShell>
  );
}

function AccountPanel({
  yearId,
  account,
  canWork,
}: {
  yearId: number;
  account: BalanceAccount;
  canWork: boolean;
}) {
  const t = useTranslations("closing.accounts");
  const { dateTime } = useFormat();
  const { pending, mutate } = useMutation();
  const [note, setNote] = useState(account.reconciled?.note ?? "");
  const [standing, setStanding] = useState(account.accountNote);
  const url = `/api/closing/${yearId}/accounts/${account.account}`;

  const mark = () => {
    const body: ReconcileAccountBody = { note };
    return mutate(url, { method: "PUT", key: "mark", body, error: t("saveFailed") });
  };
  const unmark = () => mutate(url, { method: "DELETE", key: "unmark", error: t("saveFailed") });
  const saveStanding = () => {
    if (standing.trim() === account.accountNote) return;
    const body: AccountNoteBody = { body: standing };
    return mutate(`/api/closing/accounts/${account.account}/note`, {
      method: "PUT",
      key: "standing",
      body,
      error: t("saveFailed"),
    });
  };

  if (!canWork) {
    return (
      <div className="flex flex-col gap-3 px-inset py-3 text-sm">
        {account.reconciled && (
          <p className="text-muted">
            {t("by", { name: account.reconciled.by ?? t("someone"), when: dateTime(account.reconciled.at) })}
          </p>
        )}
        {account.reconciled?.note && <p className="whitespace-pre-wrap">{account.reconciled.note}</p>}
        {account.accountNote && (
          <div>
            <p className="text-xs font-medium text-muted">{t("accountNote")}</p>
            <p className="whitespace-pre-wrap">{account.accountNote}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-inset py-3 text-sm">
      <Field label={t("accountNote")} hint={t("accountNoteHint")}>
        <Textarea
          value={standing}
          onChange={(e) => setStanding(e.target.value)}
          onBlur={saveStanding}
          aria-busy={pending === "standing" || undefined}
        />
      </Field>
      <Field label={t("note")} hint={t("noteHint")}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={pending === "mark"} onClick={mark}>
          {account.reconciled ? t("markAgain") : t("mark")}
        </Button>
        {account.reconciled && (
          <>
            <Button size="sm" variant="secondary" loading={pending === "unmark"} onClick={unmark}>
              {t("unmark")}
            </Button>
            <span className="text-xs text-muted">
              {t("by", { name: account.reconciled.by ?? t("someone"), when: dateTime(account.reconciled.at) })}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
