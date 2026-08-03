"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { IconAlert } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";

// One reusable confirmation dialog for every destructive / irreversible action,
// replacing window.confirm() and ad-hoc inline confirm UI. Use via useConfirm():
//
//   const confirm = useConfirm();
//   const ok = await confirm({ title, message, tone: "danger" });
//   if (!ok) return;
//
// Some actions have to be explained to whoever they land on — sending an utlägg
// back, reopening an attested one, undoing an export — and the comment they
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

/** `false` when dismissed. Confirming answers with the comment — "" when none
 *  was asked for — so the truthiness test every caller already does still holds. */
export type ConfirmResult = false | { comment: string };

type ConfirmFn = (opts: ConfirmOptions) => Promise<ConfirmResult>;

const Ctx = createContext<ConfirmFn | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (result: ConfirmResult) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const [pending, setPending] = useState<Pending | null>(null);
  const [comment, setComment] = useState("");

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<ConfirmResult>((resolve) => {
        setComment("");
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
    },
    [comment],
  );

  const missingComment = Boolean(pending?.comment?.required) && comment.trim() === "";

  // Esc cancels, Enter confirms — except while a comment is being written,
  // where Enter is a new paragraph and the keyboard way out is ⌘/Ctrl+Enter.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
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
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
          onClick={() => settle(false)}
        >
          <Card
            role="alertdialog"
            aria-modal="true"
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
                <h2 className="text-base font-semibold">{pending.title}</h2>
                {pending.message && (
                  <p className="mt-1 text-sm text-muted">{pending.message}</p>
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
                // Focus belongs in the comment box when there is one — the
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
      )}
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
