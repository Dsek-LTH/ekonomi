"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/components/confirm-dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { SubmitBlockerNote } from "@/components/submit-blocker-note";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { IconCheck, IconDots, IconUndo } from "@/components/ui/icons";
import type { FortnoxStatus, PaymentType } from "@/lib/domain/types";
import type { ExpenseCapabilities } from "@/lib/domain/expense-capabilities";
import { useProgressRouter } from "@/components/shell/route-progress";

// Everything the detail page can do to an utlägg, in the page header.
//
// It used to be a card at the bottom of the right-hand column: a heading and a
// stack of full-width buttons for what is usually two or three actions, taking
// the height the receipt beside it needed to be read. Here the action the
// status is actually waiting for is a labelled button, the rest sit behind
// "Mer", and the column belongs to the receipt alone.
//
// Labelled rather than icons: "Begär ändring", "Återöppna" and "Ångra export"
// have no glyph anyone would recognise, and each of them is irreversible on
// someone else's books. An aria-label answers a screen reader, not the
// bookkeeper hovering to find out which icon un-exports a verifikation.

/** The comment-carrying transitions. Each one lands on the person who filed the
 *  utlägg, so the server requires a reason and the dialog collects it.
 *
 *  `waive_deadline` is here for a second reason as well: the dispens is a
 *  decision the section has to be able to read back years later, and the reason
 *  is printed on the utläggsräkning. */
type Explained =
  | "request_changes"
  | "return_approved"
  | "unexport"
  | "waive_deadline";

/** Which label opens the dialog for each of them. Was a nested ternary that had
 *  to grow a branch per action; this grows a line. */
const EXPLAINED_TITLE: Record<Explained, string> = {
  request_changes: "requestChanges",
  return_approved: "reopen",
  unexport: "unexport",
  waive_deadline: "waiveDeadline",
};

/**
 * Exporting needs two separate Fortnox things, and the route checks both: the
 * section's service connection (409 without it) and the person's own Fortnox
 * login, which is short-lived by design (401 without it). Only the first was
 * being tested here, so with the section connected and your own login expired
 * the button looked ready and failed on click.
 */
const canExportNow = (fortnox: FortnoxStatus) =>
  fortnox.connected && Boolean(fortnox.session);

type Action = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  /** A link (edit, book) rather than a button. */
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
};

export function ExpenseActions({
  expenseId,
  can,
  busy,
  onTransition,
  onWithdrawAttest,
  onRecall,
  onRevokeDeadlineWaiver,
  onRemind,
  onDelete,
}: {
  expenseId: string;
  can: ExpenseCapabilities;
  busy: boolean;
  onTransition: (
    action: "submit" | "approve" | Explained,
    comment?: string,
  ) => Promise<boolean>;
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

  // Ask for the reason, then make the transition with it. The warning about
  // Fortnox still holding the verifikation belongs here, in the last moment
  // before it happens, rather than as standing text next to a button.
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

  // Ordered by which one the utlägg is waiting for: the first available becomes
  // the button, the rest go in the menu. Editing is last because it's always
  // possible on an open utlägg. It's the fallback when nothing else is.
  const actions: Action[] = ([
    can.canBook && {
      key: "book",
      label: t("book"),
      href: `/expenses/${expenseId}/book`,
    },
    // Bokföring is done from the review, one utlägg at a time, so this opens
    // the review at this one. Whether it can go through (Fortnox, the
    // two-person rule) is said there. See app/(app)/bookkeeping/review.
    can.canExport && {
      key: "export",
      label: t("review"),
      href: `/bookkeeping/review?id=${expenseId}`,
    },
    // Ahead of "Skicka in", because on a late utlägg it is what stands between
    // the two: nobody can submit until the dispens is given, and the person
    // reading this page is the only one who can give it.
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
      label: t("approve"),
      icon: <IconCheck className="size-4" />,
      onClick: () => onTransition("approve"),
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
    // The submitter's own, and never offered beside the attester's: one is
    // taking back a signature, the other the whole claim, and the two are
    // available to different people at different moments.
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
    // Behind the actions that move the utlägg itself, and ahead of editing: it
    // is for somebody else's turn, so it leads only when nothing else here is
    // the viewer's to do.
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
  ] as (Action | false)[]).filter((a): a is Action => a !== false);

  // Deleting is never what the page is waiting for, so it never leads.
  const [primary, ...rest] = [
    ...actions.filter((a) => !a.danger),
    ...actions.filter((a) => a.danger),
  ];

  if (!primary) return null;

  // Only buttons here. What's stopping an action lives in ExpenseActionNotice,
  // below the header. See there for why.
  return (
    // On a phone this row is the whole width of the card header, and the two
    // buttons used to share it as equals, a filled "Skicka in" and a filled
    // "Mer", wrapped onto their own line and taking 250 of 361px between them.
    // Two primaries is one too many: what the page is waiting for should have
    // the width, and everything else should have as little of it as it can
    // manage. So the first fills the row and the second is its glyph.
    <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:items-end">
      <div className="flex w-full items-center gap-2.5 sm:w-auto sm:flex-wrap">
        {primary.href ? (
          <ButtonLink href={primary.href} className="flex-1 sm:flex-none">
            {primary.icon}
            {primary.label}
          </ButtonLink>
        ) : (
          // The spinner goes on the primary action and nowhere else in this
          // row: it is the one that started the request, and the rest are
          // merely disabled while it runs.
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
            // Drawn only where the word is not: on a wide screen "Mer" says it
            // better than three dots, and both would be saying it twice.
            icon={<IconDots className="size-4 sm:hidden" />}
            className="shrink-0"
          >
            {rest.map((a, i) => (
              // Fragment, not a div: role="menu" expects its menuitems as
              // children, and a wrapper element between them breaks that.
              <Fragment key={a.key}>
                {/* A rule above the destructive action, but only when there is
                    something above it to divide. Alone in the menu, delete was
                    opening with a horizontal line ruled across nothing. */}
                {a.danger && i > 0 && <MenuSeparator />}
                <MenuItem
                  disabled={busy || a.disabled}
                  onClick={() => (a.href ? router.push(a.href) : a.onClick?.())}
                  // Colour only, no hover background of its own: MenuItem
                  // already sets one, and `cn` joins rather than merges, so two
                  // hover backgrounds would be settled by stylesheet order.
                  className={a.danger ? "text-danger" : undefined}
                >
                  {a.icon}
                  {a.label}
                </MenuItem>
              </Fragment>
            ))}
          </Menu>
        )}
      </div>
    </div>
  );
}

// Why the utlägg can't go anywhere yet, above the cards it's about.
//
// It began as small print under the buttons, which was the wrong place twice
// over: it was a whole sentence set right-aligned at max-w-xs, wrapping under
// whichever button happened to be primary and stretching a header that aligns
// on its baseline, and when a blocker exists the submit button isn't rendered
// at all, so it was explaining the absence of a button that wasn't there.
// It isn't button chrome. It's the state of the utlägg, so it reads as a line
// about the page, at the top of the page.
export function ExpenseActionNotice({
  can,
  fortnox,
  paymentType,
}: {
  can: ExpenseCapabilities;
  fortnox: FortnoxStatus;
  /** Only so the filing-deadline sentence can name what it is about, a
   *  milersättning has no receipt to call old. See SubmitBlockerNote. */
  paymentType?: PaymentType;
}) {
  const t = useTranslations("expenses.detail");

  // The export button is rendered but dead without Fortnox, and its own
  // tooltip can't say so. Button sets `disabled:pointer-events-none`. Which
  // half is missing decides where you have to go: the section's connection is
  // set up once under Bokföring, your own login is yours to renew.
  const fortnoxNote =
    can.canExport && !canExportNow(fortnox)
      ? fortnox.connected
        ? t("fortnoxNotSignedIn")
        : t("fortnoxNotConnected")
      : null;

  // The other side of the same sentence. Where the submitter is told their
  // utlägg is too old to send, whoever can do something about it is told there
  // is a decision here for them to make, because nothing else on the page would
  // say so.
  //
  // And it replaces the blocker rather than joining it. The skattmästare is an
  // admin, so they see the submitter's own hint too, and that hint ends "hör av
  // dig till skattmästaren", which is nobody's idea of help when you are the
  // skattmästare. The two sentences are about the same fact, so only the one
  // written for this reader is shown.
  const waiveNote = can.canWaiveDeadline;
  const blocker = waiveNote && can.submitBlocker === "tooLate" ? null : can.submitBlocker;

  if (!blocker && !fortnoxNote && !waiveNote) return null;

  return (
    <Notice>
      {/* Its own component rather than a line of text: one blocker sends the
          submitter to another page, and the sentence carries the link there. */}
      {blocker && <SubmitBlockerNote blocker={blocker} paymentType={paymentType} />}
      {waiveNote && <p>{t("deadlineWaiverPending")}</p>}
      {fortnoxNote && <p>{fortnoxNote}</p>}
    </Notice>
  );
}
