"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { IconAlert } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";
import { useEscape } from "@/lib/ui/escape";

// One reusable confirmation dialog for every destructive / irreversible action,
// replacing window.confirm() and ad-hoc inline confirm UI. Use via useConfirm():
//
//   const confirm = useConfirm();
//   const ok = await confirm({ title, message, tone: "danger" });
//   if (!ok) return;
//
// Some actions have to be explained to whoever they land on (sending an utlägg
// back, reopening an attested one, undoing an export) and the comment they
// carry is the same "are you sure" question, asked in words. So it's collected
// here rather than in a second dialog of its own:
//
//   const ok = await confirm({ …, comment: { label, required: true } });
//   if (!ok) return;
//   send(ok.comment);

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  /** Asks for a written reason along with the confirmation. */
  comment?: {
    label: string;
    placeholder?: string;
    /** Nothing to confirm with until something is written. */
    required?: boolean;
  };
}

/** `false` when dismissed. Confirming answers with the comment ("" when none
 *  was asked for) so the truthiness test every caller already does still holds. */
export type ConfirmResult = false | { comment: string };

type ConfirmFn = (opts: ConfirmOptions) => Promise<ConfirmResult>;

const Ctx = createContext<ConfirmFn | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (result: ConfirmResult) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const [pending, setPending] = useState<Pending | null>(null);
  // The dialog box itself, for the focus trap below.
  const boxRef = useRef<HTMLDivElement>(null);
  // Whatever had focus when the dialog opened. A modal takes focus away from
  // the control that summoned it, and has to give it back: without this, a
  // keyboard user who cancels a delete is returned to the top of the document
  // and has to find their way back down the list to the row they were on.
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();
  const [comment, setComment] = useState("");

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<ConfirmResult>((resolve) => {
        setComment("");
        // Taken before the dialog renders and steals it.
        openerRef.current = document.activeElement as HTMLElement | null;
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (ok: boolean) => {
      setPending((cur) => {
        cur?.resolve(ok ? { comment: comment.trim() } : false);
        return null;
      });
      // Back where they were. `isConnected` because the answer may have removed
      // the very row whose button opened this. Focusing a detached node puts
      // focus on <body>, which is where it would have gone anyway.
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus();
    },
    [comment],
  );

  const missingComment = Boolean(pending?.comment?.required) && comment.trim() === "";

  // Esc cancels, Enter confirms, except while a comment is being written,
  // where Enter is a new paragraph and the keyboard way out is ⌘/Ctrl+Enter.
  //
  // Tab is held inside the box. `aria-modal` tells a screen reader the rest of
  // the page is inert; it does not make it so for the keyboard, and without
  // this Tab walked straight out of the dialog and on through the page behind
  // it, where every control was still operable while a modal claimed to be
  // blocking them.
  // Escape declines, and declines only this. Anything opened on top of it
  // answers first. See lib/ui/escape.ts.
  useEscape(Boolean(pending), () => settle(false));

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const focusable = boxRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        // Wrap at whichever end you have reached, and catch the case where
        // focus is somewhere outside the box entirely.
        if (e.shiftKey && (active === first || !boxRef.current?.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key !== "Enter") return;
      if (pending.comment && !(e.metaKey || e.ctrlKey)) return;
      if (missingComment) return;
      settle(true);
    };
    window.addEventListener("keydown", onKey);
    // Below md the document is what scrolls, so the page would drift behind the
    // dialog without this.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [pending, settle, missingComment]);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {pending && (
        // Clicking away cancels. That is a mouse affordance, and it has a
        // keyboard equivalent already, Escape, handled above, so the rules
        // asking for a key handler here are asking for a second copy of one
        // that exists somewhere it works better.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
          onClick={() => settle(false)}
        >
          <div ref={boxRef} className="contents">
          <Card
            role="alertdialog"
            aria-modal="true"
            // What a screen reader announces on arrival. Without these it says
            // "dialog" and then reads whatever focus landed on, which for a
            // destructive confirm is the word "Ta bort" with none of the
            // sentence that explains what is about to be removed.
            aria-labelledby={titleId}
            aria-describedby={pending.message ? messageId : undefined}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              // p-5 rather than the card inset: a dialog is read at arm's
              // length from its own edges, not laid out against a page column.
              "w-full p-5",
              // A textarea in a max-w-sm box is a slot, not somewhere to write.
              pending.comment ? "max-w-md" : "max-w-sm",
            )}
          >
            <div className="flex gap-3">
              {pending.tone === "danger" && (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
                  <IconAlert className="size-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-base font-semibold">{pending.title}</h2>
                {pending.message && (
                  <p id={messageId} className="mt-1 text-sm text-muted">{pending.message}</p>
                )}
              </div>
            </div>
            {pending.comment && (
              <div className="mt-4">
                <Field label={pending.comment.label}>
                  <Textarea
                    autoFocus
                    rows={3}
                    value={comment}
                    placeholder={pending.comment.placeholder}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </Field>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2.5">
              <Button variant="secondary" size="sm" onClick={() => settle(false)}>
                {pending.cancelLabel ?? t("cancel")}
              </Button>
              <Button
                // Focus belongs in the comment box when there is one. The
                // confirm button is the last step there, not the first.
                autoFocus={!pending.comment}
                variant={pending.tone === "danger" ? "danger" : "primary"}
                size="sm"
                disabled={missingComment}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? t("confirm")}
              </Button>
            </div>
          </Card>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
