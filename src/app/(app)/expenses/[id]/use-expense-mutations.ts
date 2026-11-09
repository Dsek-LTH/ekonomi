"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useReturnTo } from "@/components/shell/route-history";

type TransitionAction =
  | "submit"
  | "approve"
  | "withdraw_attest"
  | "recall"
  | "request_changes"
  | "return_approved"
  | "unexport"
  // Neither of these moves the status. They decide whether the filing
  // deadline stands in the way of the submit that follows.
  | "waive_deadline"
  | "revoke_deadline_waiver";

// Every write the detail page can make, over the /api/expenses/:id/* routes.
// Matching gets its own busy scope so picking a transaction doesn't grey out
// the action buttons.
export function useExpenseMutations(expenseId: string) {
  const t = useTranslations("expenses.mutations");
  // The dispens dialog reuses the detail page's own labels: the button that
  // opens it and the button that confirms it say the same thing.
  const tDetail = useTranslations("expenses.detail");
  const tBookkeeping = useTranslations("bookkeeping");
  const notify = useNotify();
  const returnTo = useReturnTo();
  const confirm = useConfirm();
  const action = useMutation();
  const matcher = useMutation();
  // Deleting navigates away; stay busy until it does, so the button can't fire twice.
  const [deleted, setDeleted] = useState(false);

  const url = (path = "") => `/api/expenses/${expenseId}${path}`;

  // Returns whether it went through, so the caller can clear its own form state.
  async function transition(
    act: TransitionAction,
    comment?: string,
    allocationIds?: string[],
  ): Promise<boolean> {
    const data = await action.mutate(url("/transition"), {
      body: { action: act, comment, allocationIds },
      // One confirmation per transition, under `expenses.mutations.transition`.
      success: t(`transition.${act}`),
    });
    return data !== null;
  }

  /** Taking a dispens back, confirmed: the utlägg is late by definition, so nobody can submit it again without a new dispens. */
  async function revokeDeadlineWaiver() {
    const ok = await confirm({
      title: tDetail("revokeDeadlineWaiver"),
      message: tDetail("revokeWaiverConfirm"),
      confirmLabel: tDetail("revokeDeadlineWaiver"),
      tone: "danger",
    });
    if (ok) await transition("revoke_deadline_waiver");
  }

  // Confirmed, because on a fully approved expense it visibly knocks the status
  // back to "awaiting approval" for everyone else too. With `row`, only that
  // cost centre's signature, and the dialog names it.
  async function withdrawAttest(row?: { id: string; costCenter: string }): Promise<boolean> {
    const ok = await confirm({
      title: t("withdraw.title"),
      message: row
        ? t("withdraw.messageRow", { costCenter: row.costCenter })
        : t("withdraw.message"),
      confirmLabel: t("withdraw.confirm"),
    });
    if (!ok) return false;
    return transition("withdraw_attest", undefined, row ? [row.id] : undefined);
  }

  /** The submitter taking their whole claim back, to a draft. Always confirmed, worded by what it costs (attested signatures are thrown away).
   * `attested` is counted by the caller. */
  async function recall(attested: number) {
    const ok = await confirm({
      title: t("recall.title"),
      message:
        attested > 0 ? t("recall.messageAttested", { count: attested }) : t("recall.message"),
      confirmLabel: t("recall.confirm"),
    });
    if (ok) await transition("recall");
  }

  async function match(transactionId: string | null) {
    await matcher.mutate(url("/match"), {
      body: { transactionId },
      error: t("match.failed"),
      success: transactionId ? t("match.matched") : t("match.removed"),
    });
  }

  async function remove() {
    const ok = await confirm({
      title: t("delete.title"),
      message: t("delete.message"),
      confirmLabel: t("delete.confirm"),
      tone: "danger",
    });
    if (!ok) return;
    const data = await action.mutate(url(), {
      method: "DELETE",
      error: t("delete.failed"),
      success: t("delete.done"),
    });
    if (!data) return;
    setDeleted(true);
    // Not a push: the utlägg is gone, and pushing left it behind its own list on Back.
    returnTo("/expenses");
  }

  /** Bokföring: the voucher sent to Fortnox from the utlägg's own page. The confirmation is built from the answer
   * (Fortnox names the voucher), and a receipt that would not attach is said with it. */
  async function exportToFortnox(label: string): Promise<boolean> {
    const data = await action.mutate<{ label: string; attachWarning: string | null }>(
      url("/export"),
      {
        key: "export",
        error: tBookkeeping("exportFailed", { id: label }),
      },
    );
    if (!data) return false;
    const done = tBookkeeping("exportDone", { id: label, label: data.label });
    if (data.attachWarning) {
      notify.info(`${done}. ${t("export.attachWarning", { detail: data.attachWarning })}`);
    } else notify.success(`${done}.`);
    return true;
  }

  return {
    busy: action.busy || deleted,
    exportToFortnox,
    matching: matcher.busy,
    transition,
    withdrawAttest,
    recall,
    revokeDeadlineWaiver,
    match,
    remove,
  };
}
