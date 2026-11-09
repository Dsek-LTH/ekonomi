"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/components/confirm-dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Tooltip } from "@/components/ui/tooltip";
import { SubmitBlockerNote } from "@/components/submit-blocker-note";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { IconCheck, IconDots, IconUndo } from "@/components/ui/icons";
import type { FortnoxStatus, PaymentType } from "@/lib/domain/types";
import type { ExpenseCapabilities } from "@/lib/domain/expense-capabilities";
import { useProgressRouter } from "@/components/shell/route-progress";

// Everything the detail page can do to an utlägg, in the page header. The action the status waits for is a labelled button, the rest sit behind "Mer".
// Labelled rather than icons: each is irreversible on someone else's books and has no recognisable glyph.

/** The comment-carrying transitions: each lands on the person who filed the utlägg, so the dialog collects a reason.
 * `waive_deadline`'s reason is printed on the utläggsräkning. */
type Explained = "request_changes" | "return_approved" | "unexport" | "waive_deadline";

/** Which label opens the dialog for each of them. */
const EXPLAINED_TITLE: Record<Explained, string> = {
  request_changes: "requestChanges",
  return_approved: "reopen",
  unexport: "unexport",
  waive_deadline: "waiveDeadline",
};

/** Exporting needs the section's service connection (409 without it) and the person's own short-lived Fortnox login (401 without it). */
const canExportNow = (fortnox: FortnoxStatus) => fortnox.connected && Boolean(fortnox.session);

type Action = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  /** A link (edit, book) rather than a button. */
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Why it is disabled, on hover and for a screen reader. */
  disabledReason?: string;
  danger?: boolean;
};

export function ExpenseActions({
  expenseId,
  can,
  fortnox,
  exportBlock,
  onExport,
  busy,
  onTransition,
  onApprove,
  approveAll,
  onWithdrawAttest,
  onRecall,
  onRevokeDeadlineWaiver,
  onRemind,
  onDelete,
}: {
  expenseId: string;
  can: ExpenseCapabilities;
  /** Whether bokföring can happen from here now: the section connected and
   *  the reader's own login live. */
  fortnox: FortnoxStatus;
  /** Why the reader may not bokföra it besides Fortnox (the two-person rule,
   *  somebody else's export under way), or null. */
  exportBlock: string | null;
  /** Bokföring: the voucher sent to Fortnox from here. */
  onExport: () => void;
  busy: boolean;
  onTransition: (action: "submit" | Explained, comment?: string) => Promise<boolean>;
  /** Signs every row the viewer may attest. */
  onApprove: () => void;
  /** How many rows that is, when there is more than one. Null otherwise. */
  approveAll: number | null;
  onWithdrawAttest: () => void;
  onRecall: () => void;
  onRevokeDeadlineWaiver: () => void;
  onRemind: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("expenses.detail");
  const tComment = useTranslations("expenses.detail.comment");
  const confirm = useConfirm();
  const router = useProgressRouter();

  // Ask for the reason, then make the transition. The Fortnox warning belongs here, in the last moment.
  async function explain(action: Explained) {
    const answer = await confirm({
      title: t(EXPLAINED_TITLE[action]),
      message: action === "unexport" ? t("unexportWarning") : undefined,
      confirmLabel: tComment(`${action}.submit`),
      tone: action === "unexport" ? "danger" : "default",
      comment: {
        label: tComment(`${action}.label`),
        placeholder: tComment(`${action}.placeholder`),
        required: true,
      },
    });
    if (!answer) return;
    await onTransition(action, answer.comment);
  }

  // Ordered by which one the utlägg is waiting for: the first available becomes the button, the rest go in the menu. Editing is the fallback.
  const actions: Action[] = (
    [
      can.canBook && {
        key: "book",
        label: t("book"),
        href: `/expenses/${expenseId}/book`,
      },
      // Bokföring, done here: dead when it could not go through, with the reason on the button.
      can.canExport &&
        (() => {
          const reason = !canExportNow(fortnox)
            ? fortnox.connected
              ? t("fortnoxNotSignedIn")
              : t("fortnoxNotConnected")
            : exportBlock;
          return {
            key: "export",
            label: t("review"),
            onClick: onExport,
            disabled: reason !== null,
            disabledReason: reason ?? undefined,
          };
        })(),
      // Ahead of "Skicka in": on a late utlägg nobody can submit until the dispens is given.
      can.canWaiveDeadline && {
        key: "waive_deadline",
        label: t("waiveDeadline"),
        onClick: () => explain("waive_deadline"),
      },
      can.canSubmit && {
        key: "submit",
        label: t("submit"),
        icon: <IconCheck className="size-4" />,
        onClick: () => onTransition("submit"),
      },
      can.canApprove && {
        key: "approve",
        // Beside the rows' own buttons, so it is clear this one signs every row.
        label: approveAll ? t("approveAll", { count: approveAll }) : t("approve"),
        icon: <IconCheck className="size-4" />,
        onClick: onApprove,
      },
      can.canRequestChanges && {
        key: "request_changes",
        label: t("requestChanges"),
        onClick: () => explain("request_changes"),
      },
      can.canReturn && {
        key: "return_approved",
        label: t("reopen"),
        onClick: () => explain("return_approved"),
      },
      can.canUnexport && {
        key: "unexport",
        label: t("unexport"),
        icon: <IconUndo className="size-4" />,
        onClick: () => explain("unexport"),
      },
      can.canWithdrawAttest && {
        key: "withdraw_attest",
        label: t("withdrawAttest"),
        icon: <IconUndo className="size-4" />,
        onClick: onWithdrawAttest,
      },
      // The submitter's own, never beside the attester's: one takes back a signature, the other the whole claim.
      can.canRecall && {
        key: "recall",
        label: t("recall"),
        icon: <IconUndo className="size-4" />,
        onClick: onRecall,
      },
      can.canRevokeDeadlineWaiver && {
        key: "revoke_deadline_waiver",
        label: t("revokeDeadlineWaiver"),
        icon: <IconUndo className="size-4" />,
        onClick: onRevokeDeadlineWaiver,
      },
      // For somebody else's turn, so it leads only when nothing else here is the viewer's to do.
      can.canRemind && {
        key: "remind",
        label: t("remind"),
        onClick: onRemind,
      },
      can.canEdit && {
        key: "edit",
        label: t("edit"),
        href: `/expenses/${expenseId}/edit`,
      },
      can.canDelete && {
        key: "delete",
        label: t("delete"),
        onClick: onDelete,
        danger: true,
      },
    ] as (Action | false)[]
  ).filter((a): a is Action => a !== false);

  // Deleting is never what the page is waiting for, so it never leads.
  const [primary, ...rest] = [
    ...actions.filter((a) => !a.danger),
    ...actions.filter((a) => a.danger),
  ];

  if (!primary) return null;

  // Only buttons here. What stops an action is in ExpenseActionNotice.
  return (
    // On a phone two primaries are one too many: the first fills the row and the second is its glyph.
    <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:items-end">
      <div className="flex w-full items-center gap-2.5 sm:w-auto sm:flex-wrap">
        {primary.disabledReason ? (
          // A disabled button takes no pointer events (ui/button.tsx), so the wrapper is hovered. Not a link: a link cannot be disabled.
          <Tooltip label={primary.disabledReason} align="start" className="flex-1 sm:flex-none">
            <Button disabled className="w-full">
              {primary.icon}
              {primary.label}
              <span className="sr-only">{`. ${primary.disabledReason}`}</span>
            </Button>
          </Tooltip>
        ) : primary.href ? (
          <ButtonLink href={primary.href} className="flex-1 sm:flex-none">
            {primary.icon}
            {primary.label}
          </ButtonLink>
        ) : (
          // The spinner goes on the primary action only.
          <Button
            loading={busy}
            disabled={primary.disabled}
            onClick={primary.onClick}
            className="flex-1 sm:flex-none"
          >
            {primary.icon}
            {primary.label}
          </Button>
        )}

        {rest.length > 0 && (
          <Menu
            label={t("more")}
            variant="secondary"
            disabled={busy}
            compact
            // Drawn only where the word is not.
            icon={<IconDots className="size-4 sm:hidden" />}
            className="shrink-0"
          >
            {rest.map((a, i) => (
              // Fragment, not a div: role="menu" expects its menuitems as
              // children, and a wrapper element between them breaks that.
              <Fragment key={a.key}>
                {/* A rule only when there is something above to divide. */}
                {a.danger && i > 0 && <MenuSeparator />}
                <MenuItem
                  disabled={busy || a.disabled}
                  onClick={() => (a.href ? router.push(a.href) : a.onClick?.())}
                  // Colour only: MenuItem sets a hover background and `cn` joins rather than merges.
                  className={a.danger ? "text-danger" : undefined}
                >
                  {a.icon}
                  {a.label}
                  {a.disabledReason && <span className="sr-only">{`. ${a.disabledReason}`}</span>}
                </MenuItem>
              </Fragment>
            ))}
          </Menu>
        )}
      </div>
    </div>
  );
}

// Why the utlägg can't go anywhere yet, above the cards it's about. It is the state of the utlägg, not button chrome.
export function ExpenseActionNotice({
  can,
  fortnox,
  paymentType,
}: {
  can: ExpenseCapabilities;
  fortnox: FortnoxStatus;
  /** So the filing-deadline sentence can name what it is about (a milersättning has no receipt). */
  paymentType?: PaymentType;
}) {
  const t = useTranslations("expenses.detail");

  // The section's connection missing is said here as well as on the button (set up once, by somebody else).
  // A lapsed personal login is said only on the button.
  const fortnoxNote = can.canExport && !fortnox.connected ? t("fortnoxNotConnected") : null;

  // Where the submitter is told the utlägg is too old to send, whoever can grant a dispens is told here.
  // It replaces the blocker, whose hint ends "hör av dig till skattmästaren".
  const waiveNote = can.canWaiveDeadline;
  const blocker = waiveNote && can.submitBlocker === "tooLate" ? null : can.submitBlocker;

  if (!blocker && !fortnoxNote && !waiveNote) return null;

  return (
    <Notice>
      {blocker && <SubmitBlockerNote blocker={blocker} paymentType={paymentType} />}
      {waiveNote && <p>{t("deadlineWaiverPending")}</p>}
      {fortnoxNote && <p>{fortnoxNote}</p>}
    </Notice>
  );
}
