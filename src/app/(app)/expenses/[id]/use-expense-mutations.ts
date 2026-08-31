"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useNotify } from "@/components/shell/notifications";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useReturnTo } from "@/components/shell/route-history";

export type TransitionAction =
  | "submit"
  | "approve"
  | "withdraw_attest"
  | "recall"
  | "request_changes"
  | "return_approved"
  | "unexport";

// Every write the detail page can make, over the /api/expenses/:id/* routes.
// Matching gets its own busy scope so picking a transaction doesn't grey out
// the action buttons.
export function useExpenseMutations(expenseId: string) {
  const t = useTranslations("expenses.mutations");
  const returnTo = useReturnTo();
  const notify = useNotify();
  const confirm = useConfirm();
  const action = useMutation();
  const matcher = useMutation();
  // Deleting navigates away; stay busy until it does, so the button can't fire twice.
  const [deleted, setDeleted] = useState(false);

  const url = (path = "") => `/api/expenses/${expenseId}${path}`;

  // Returns whether it went through, so the caller can clear its own form state.
  async function transition(act: TransitionAction, comment?: string): Promise<boolean> {
    const data = await action.mutate(url("/transition"), {
      body: { action: act, comment },
      // One confirmation per transition, under `expenses.mutations.transition`.
      success: t(`transition.${act}`),
    });
    return data !== null;
  }

  // Confirmed, because on a fully approved expense it visibly knocks the status
  // back to "awaiting approval" for everyone else too.
  async function withdrawAttest() {
    const ok = await confirm({
      title: t("withdraw.title"),
      message: t("withdraw.message"),
      confirmLabel: t("withdraw.confirm"),
    });
    if (ok) await transition("withdraw_attest");
  }

  /**
   * The submitter taking their whole claim back, to a draft.
   *
   * Always confirmed, and the wording depends on what it costs. On an utlägg
   * nobody has touched it is an undo; on one somebody has already attested in
   * part it also throws those signatures away, and somebody about to correct a
   * payment type should know they are asking a colleague to sign again.
   *
   * `attested` is how many rows are signed — the caller counts them, since it
   * is the one holding the utlägg.
   */
  async function recall(attested: number) {
    const ok = await confirm({
      title: t("recall.title"),
      message: attested > 0 ? t("recall.messageAttested", { count: attested }) : t("recall.message"),
      confirmLabel: t("recall.confirm"),
    });
    if (ok) await transition("recall");
  }

  // Export to Fortnox is a real API call (its own route), not a status flip, and
  // it can half-succeed — the voucher lands but the receipt doesn't attach.
  async function exportToFortnox() {
    const data = await action.mutate(url("/export"), { error: t("export.failed") });
    if (!data) return;
    const done = t("export.done", { label: String(data.label) });
    // The warning describes itself — pass it through rather than wrapping it in
    // a summary that leaves the bookkeeper with nothing to act on.
    if (data.attachWarning) {
      notify.info(`${done}. ${t("export.attachWarning", { detail: String(data.attachWarning) })}`);
    }
    else notify.success(`${done}.`);
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
    // Not a push: the utlägg this page describes is gone, and pushing left it
    // sitting behind its own list on the Back button.
    returnTo("/expenses");
  }

  return {
    busy: action.busy || deleted,
    matching: matcher.busy,
    transition,
    withdrawAttest,
    recall,
    exportToFortnox,
    match,
    remove,
  };
}
