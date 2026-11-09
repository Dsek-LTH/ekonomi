"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { IconAlert } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";
import { DialogLayer } from "@/components/ui/modal";

// One reusable confirmation dialog for every destructive or irreversible action. Use via useConfirm():
//   const ok = await confirm({ title, message, tone: "danger", comment: { label, required: true } });
// With a comment, `ok.comment` holds the written reason.

interface ConfirmOptions {
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
type ConfirmResult = false | { comment: string };

type ConfirmFn = (opts: ConfirmOptions) => Promise<ConfirmResult>;

const Ctx = createContext<ConfirmFn | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (result: ConfirmResult) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const [pending, setPending] = useState<Pending | null>(null);
  // Whatever had focus when the dialog opened, to give it back on close.
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
      // `isConnected` because the answer may have removed the row whose button opened this.
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus();
    },
    [comment],
  );

  const missingComment = Boolean(pending?.comment?.required) && comment.trim() === "";

  // Enter confirms, except while a comment is being written (⌘/Ctrl+Enter then). Escape, focus trap and
  // scroll lock are `DialogLayer`'s.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (pending.comment && !(e.metaKey || e.ctrlKey)) return;
      if (missingComment) return;
      settle(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, settle, missingComment]);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {pending && (
        <DialogLayer
          onDismiss={() => settle(false)}
          className="flex items-center justify-center p-4"
        >
          <Card
            role="alertdialog"
            aria-modal="true"
            // Announced by screen readers on arrival.
            aria-labelledby={titleId}
            aria-describedby={pending.message ? messageId : undefined}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "w-full p-5",
              // A textarea in a max-w-sm box is a slot, not somewhere to write.
              pending.comment ? "max-w-md" : "max-w-sm",
            )}
          >
            <div className="flex gap-3">
              {pending.tone === "danger" && (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-danger-soft text-danger">
                  <IconAlert className="size-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-base font-semibold">
                  {pending.title}
                </h2>
                {pending.message && (
                  <p id={messageId} className="mt-1 text-sm text-muted">
                    {pending.message}
                  </p>
                )}
              </div>
            </div>
            {pending.comment && (
              <div className="mt-4">
                <Field
                  label={pending.comment.label}
                  requirement={pending.comment.required ? "required" : "optional"}
                >
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
                // Focus belongs in the comment box when there is one.
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
        </DialogLayer>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
