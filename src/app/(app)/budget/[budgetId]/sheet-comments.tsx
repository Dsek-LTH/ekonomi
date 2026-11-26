"use client";

// Comments on a budget sheet, pinned like spreadsheet notes to one cell: an account's number, or
// a line's Beskrivning or Belopp. A commented cell has a filled pink corner. Pointing at the cell
// shows the thread; a click on the corner or the right-click menu pins it open to answer.
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { IconComment, IconTrash, IconX } from "@/components/ui/icons";
import { UserAvatar } from "@/components/ui/avatar";
import { placeAnchored, useAnchorRect } from "@/lib/ui/anchored-panel";
import { useDismissOnOutside } from "@/lib/ui/dismiss";
import { useEscape } from "@/lib/ui/escape";
import { cn } from "@/lib/ui/utils";
import type { CommentField } from "@/lib/budget/payload";
import type { BudgetCC, Comment } from "./budget-types";
import { useSheet } from "./sheet-context";

export type CommentTarget =
  { kind: "account"; accountId: string } | { kind: "line"; lineId: string; field: CommentField };

export const targetKey = (t: CommentTarget) =>
  t.kind === "account" ? `a:${t.accountId}` : `l:${t.lineId}:${t.field}`;

/** The comments at `target`, read from the sheet as it stands (so a reply shows at once). */
export function commentsAt(cc: BudgetCC, target: CommentTarget): Comment[] {
  for (const a of cc.accounts) {
    if (target.kind === "account") {
      if (a.id === target.accountId) return a.comments;
      continue;
    }
    const li = a.lineItems.find((l) => l.id === target.lineId);
    if (li) return (li.comments ?? []).filter((c) => c.field === target.field);
  }
  return [];
}

interface OpenThread {
  target: CommentTarget;
  /** The cell the panel sits beside. */
  anchor: HTMLElement;
  /** Opened on purpose (a click, the menu): stays until dismissed. Otherwise it follows the pointer. */
  pinned: boolean;
}

/** The one thread a sheet shows at a time, and the hover timing that opens and closes it. */
export function useCommentThreads() {
  const [thread, setThread] = useState<OpenThread | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = () => clearTimeout(timer.current);

  return {
    thread,
    open(target: CommentTarget, anchor: HTMLElement) {
      clear();
      setThread({ target, anchor, pinned: true });
    },
    /** Pointing at something commented: shown after a beat, unless a pinned thread is open. */
    hover(target: CommentTarget, anchor: HTMLElement) {
      clear();
      timer.current = setTimeout(
        () => setThread((t) => (t?.pinned ? t : { target, anchor, pinned: false })),
        250,
      );
    },
    /** The pointer left: a hover thread goes, with a moment to reach the panel itself. */
    leave() {
      clear();
      timer.current = setTimeout(() => setThread((t) => (t?.pinned ? t : null)), 200);
    },
    stay: clear,
    pin() {
      setThread((t) => t && { ...t, pinned: true });
    },
    close() {
      clear();
      setThread(null);
    },
  };
}
export type CommentThreads = ReturnType<typeof useCommentThreads>;

/** The pink corner of a commented cell. Its cell must be `relative`. */
export function CellMark({ target, count }: { target: CommentTarget; count: number }) {
  const { comments, t } = useSheet();
  if (count === 0) return null;
  return (
    <button
      type="button"
      aria-label={t("cellComments", { count })}
      onClick={(e) => comments.open(target, e.currentTarget.closest("td") ?? e.currentTarget)}
      className="absolute right-0 top-0 z-[1] size-3"
    >
      <span
        aria-hidden
        className="absolute right-0 top-0 size-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-action-from"
      />
    </button>
  );
}

/** The open thread, beside what it belongs to. One per sheet. */
export function CommentPanel() {
  const { thread } = useSheet();
  // The last thread shown stays drawn for the fade out after it closes. Followed during render,
  // React's pattern for state that tracks a prop, so the panel never draws a frame behind.
  const [last, setLast] = useState(thread);
  if (thread && thread !== last) setLast(thread);
  const leaving = !thread && last !== null;
  useEffect(() => {
    if (!leaving) return;
    const done = setTimeout(() => setLast(null), FADE_MS);
    return () => clearTimeout(done);
  }, [leaving]);

  const shown = thread ?? last;
  if (!shown) return null;
  // Keyed, so moving to another thread starts with that thread's draft and placement.
  return <Panel key={targetKey(shown.target)} thread={shown} leaving={leaving} />;
}

/** The fade, in and out. Matches `duration-150` on the panel. */
const FADE_MS = 150;

function Panel({ thread, leaving }: { thread: OpenThread; leaving: boolean }) {
  const {
    canComment,
    cc,
    ccCode,
    commentDraft,
    comments: threads,
    date,
    deleteComment,
    grid,
    isAdmin,
    postComment,
    t,
    tCol,
    userId,
  } = useSheet();
  const { target, anchor, pinned } = thread;
  const key = targetKey(target);
  const list = commentsAt(cc, target);

  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const panelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [rect, setRect] = useAnchorRect(true, anchorRef, panelRef, threads.close);
  const [sending, setSending] = useState(false);

  // Measured in a frame, as Menu does, rather than set during render.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setRect(anchor.getBoundingClientRect());
      if (pinned && canComment) textRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
    // Once per thread (the component is keyed by it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The anchor counts as inside, so a click on the corner that opened it pins rather than closes.
  // Neither while fading out: it is already closed.
  useDismissOnOutside(!leaving, [panelRef, anchorRef], threads.close);
  // Only a thread opened on purpose: a hover one must not take Escape from the cell being edited.
  useEscape(pinned && !leaving, threads.close);

  const draft = commentDraft.get(key);
  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await postComment(target, body);
    setSending(false);
    if (ok) commentDraft.set(key, "");
  }

  const where = (() => {
    if (target.kind === "account") {
      const a = cc.accounts.find((x) => x.id === target.accountId);
      return a ? `${a.accountCode} - ${a.accountName}` : "";
    }
    const row = grid.lineRow.get(`${ccCode}|${target.lineId}`);
    const n = row !== undefined ? `#${row}` : "";
    return `${n} - ${tCol(target.field === "description" ? "beskrivning" : "expression")}`;
  })();

  if (!rect) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("commentsOn", { where })}
      data-popup-layer=""
      style={placeAnchored(rect, { wanted: 280, width: 320 })}
      aria-hidden={leaving || undefined}
      onMouseEnter={threads.stay}
      onMouseLeave={pinned ? undefined : threads.leave}
      onPointerDown={threads.pin}
      className={cn(
        "z-[205] flex flex-col overflow-hidden rounded-panel border border-border bg-background shadow-[var(--shadow-pop)]",
        // Fades in from where it is drawn (@starting-style) and back out while `leaving`.
        "transition-[opacity,scale] duration-150 ease-[var(--ease-out-quint)] starting:scale-[0.98] starting:opacity-0 motion-reduce:transition-none",
        leaving && "pointer-events-none scale-[0.98] opacity-0",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 py-1.5 pl-3 pr-1.5">
        <IconComment className="size-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted">{where}</span>
        <IconButton size="sm" onClick={threads.close} label={t("closeComments")}>
          <IconX className="size-4" />
        </IconButton>
      </div>

      {list.length > 0 && (
        <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {list.map((cm) => (
            <li key={cm.id} className="group flex gap-2.5">
              <UserAvatar userId={cm.author.id} name={cm.author.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2 text-xs">
                  <span className="truncate font-medium text-foreground">{cm.author.name}</span>
                  <span className="shrink-0 text-muted">{date(cm.createdAt)}</span>
                  {(cm.author.id === userId || isAdmin) && (
                    <span className="ml-auto -my-1 shrink-0">
                      <IconButton
                        size="sm"
                        tone="danger"
                        reveal
                        onClick={() => deleteComment(cm.id)}
                        label={t("removeComment")}
                      >
                        <IconTrash className="size-3.5" />
                      </IconButton>
                    </span>
                  )}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{cm.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <div className={cn("p-2", list.length > 0 && "border-t border-border/60")}>
          <textarea
            ref={textRef}
            rows={2}
            value={draft}
            onChange={(e) => commentDraft.set(key, e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a new line, as in a chat.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={list.length ? t("replyPlaceholder") : t("commentPlaceholder")}
            aria-label={t("commentPlaceholder")}
            className="field-sizing-content max-h-40 min-h-14 w-full resize-none rounded-control border border-border-control bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-action-from"
          />
          <div className="mt-1.5 flex justify-end">
            <Button size="xs" onClick={send} disabled={!draft.trim()} loading={sending}>
              {t("sendComment")}
            </Button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
