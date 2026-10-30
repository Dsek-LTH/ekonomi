"use client";

// A row of thumbnails along the foot of the receipt panel, for a page where
// the documents are still being put together (the utlägg form). Tap one to
// look at it, drag one to put it somewhere else, take one off with its cross,
// add another with the last tile. The order is the order the viewer stacks
// them and the order they are stapled behind the cover for Fortnox.
//
// The drag is the voucher editor's (components/voucher-editor.tsx), turned on
// its side: a pointer drag, so it works with a finger as well as a mouse; the
// tile follows the hand, the others make way as it passes them, it stays where
// it is let go, and Escape puts the row back. A press that never moves is a
// tap, which is how one tile both selects and drags.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconPlus, IconReceipt, IconX } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";

export interface StripItem {
  key: string;
  src: string;
  mimeType: string;
  filename?: string;
}

// How far a press has to travel before it is a drag rather than a tap.
const SLOP = 5;

interface Drag {
  key: string;
  startX: number;
  startIndex: number;
  index: number;
  keys: string[];
  /** One tile's width plus the gap. */
  step: number;
  before: string[];
  /** Past the slop: a drag, not a tap. */
  moving: boolean;
}

export function DocumentStrip({
  items,
  current,
  onSelect,
  onReorder,
  onRemove,
  onAdd,
  disabled,
}: {
  items: StripItem[];
  /** Which one the viewer has in view. */
  current: number;
  onSelect: (i: number) => void;
  onReorder: (keys: string[]) => void;
  onRemove: (key: string) => void;
  onAdd?: () => void;
  disabled: boolean;
}) {
  const t = useTranslations("receipt");
  const drag = useRef<Drag | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [draggedBy, setDraggedBy] = useState(0);
  // Whether the press has turned into a drag. The ref says so to the handlers;
  // this says so to the render.
  const [moving, setMoving] = useState(false);
  // The handlers below are registered once per drag; these keep them reading
  // the page's current callbacks rather than the ones from when it started.
  const handlers = useRef({ onReorder, onSelect });
  useEffect(() => {
    handlers.current = { onReorder, onSelect };
  });

  function press(e: React.PointerEvent, key: string) {
    if (e.button !== 0) return;
    const tile = e.currentTarget as HTMLElement;
    const index = items.findIndex((i) => i.key === key);
    if (index === -1) return;
    const keys = items.map((i) => i.key);
    drag.current = {
      key,
      startX: e.clientX,
      startIndex: index,
      index,
      keys,
      step: tile.getBoundingClientRect().width + 8,
      before: keys,
      moving: false,
    };
    setDraggingKey(key);
    setDraggedBy(0);
  }

  useEffect(() => {
    if (!draggingKey) return;
    const end = () => {
      drag.current = null;
      setDraggingKey(null);
      setDraggedBy(0);
      setMoving(false);
    };
    const up = () => {
      const d = drag.current;
      // Never moved: it was a tap, on whichever tile it started on.
      if (d && !d.moving) handlers.current.onSelect(d.startIndex);
      end();
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const delta = e.clientX - d.startX;
      if (!d.moving) {
        if (Math.abs(delta) < SLOP || disabled) return;
        d.moving = true;
        setMoving(true);
      }
      const last = d.keys.length - 1;
      const wanted = Math.min(Math.max(d.startIndex + Math.round(delta / d.step), 0), last);
      if (wanted !== d.index) {
        const next = d.keys.slice();
        next.splice(wanted, 0, ...next.splice(d.index, 1));
        d.keys = next;
        d.index = wanted;
        handlers.current.onReorder(next);
      }
      const offset = delta - (d.index - d.startIndex) * d.step;
      setDraggedBy(Math.min(Math.max(offset, -d.index * d.step), (last - d.index) * d.step));
    };
    const cancel = () => {
      const d = drag.current;
      if (d?.moving) handlers.current.onReorder(d.before);
      end();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [draggingKey, disabled]);

  return (
    <div className="shrink-0 border-t border-border bg-background px-3 py-2.5">
      {/* The padding is room inside the scrollport for what stands outside a
          tile: the selected one's ring and the remove button over its corner.
          A box that scrolls on one axis clips on both, so without it they were
          cut off at the edges. The negative margin gives the same room back,
          so the tiles still line up with the hint under them. */}
      <ul
        className="-mx-1.5 -mt-1.5 flex items-start gap-2 overflow-x-auto px-1.5 pb-0.5 pt-1.5"
        aria-label={t("documents")}
      >
        {items.map((item, i) => {
          const held = draggingKey === item.key;
          return (
            <li
              key={item.key}
              style={held && moving ? { transform: `translateX(${draggedBy}px)` } : undefined}
              className={cn("group relative shrink-0", held && moving && "z-10")}
            >
              <button
                type="button"
                onPointerDown={(e) => press(e, item.key)}
                // The keyboard's way in: Enter or Space selects, since the
                // press above only ever fires for a pointer.
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(i);
                  }
                  if (e.altKey && e.key === "ArrowLeft" && i > 0 && !disabled) {
                    e.preventDefault();
                    const keys = items.map((x) => x.key);
                    keys.splice(i - 1, 0, ...keys.splice(i, 1));
                    onReorder(keys);
                  }
                  if (e.altKey && e.key === "ArrowRight" && i < items.length - 1 && !disabled) {
                    e.preventDefault();
                    const keys = items.map((x) => x.key);
                    keys.splice(i + 1, 0, ...keys.splice(i, 1));
                    onReorder(keys);
                  }
                }}
                aria-current={i === current ? "true" : undefined}
                aria-label={t("showDocument", { n: i + 1, name: item.filename ?? "" })}
                title={t("documentTileHint")}
                className={cn(
                  "flex h-16 w-12 touch-none select-none items-center justify-center overflow-hidden rounded-control border bg-surface",
                  i === current ? "border-accent ring-1 ring-accent" : "border-border",
                  held && moving ? "cursor-grabbing shadow-[var(--shadow-card)]" : "cursor-pointer",
                )}
              >
                <Thumb item={item} />
              </button>
              {/* Clear of the tile's border and ring, which a badge at 2px sat on. */}
              <span className="pointer-events-none absolute bottom-1 left-1 rounded-mark bg-background/90 px-1 text-[10px] font-medium tabular-nums">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => onRemove(item.key)}
                onPointerDown={(e) => e.stopPropagation()}
                disabled={disabled}
                aria-label={t("removeDocumentN", { n: i + 1 })}
                title={t("removeDocumentN", { n: i + 1 })}
                className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted opacity-0 shadow-sm transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:hidden [@media(hover:none)]:opacity-100"
              >
                <IconX className="size-3" />
              </button>
            </li>
          );
        })}
        {onAdd && (
          <li className="shrink-0">
            <button
              type="button"
              onClick={onAdd}
              disabled={disabled}
              aria-label={t("addDocument")}
              title={t("addDocument")}
              className="flex h-16 w-12 items-center justify-center rounded-control border border-dashed border-border text-muted hover:bg-hover hover:text-foreground disabled:opacity-40"
            >
              <IconPlus className="size-4" />
            </button>
          </li>
        )}
      </ul>
      {items.length > 1 && <p className="mt-1.5 text-xs text-muted">{t("stripHint")}</p>}
    </div>
  );
}

// The picture itself where the browser can draw it, and a plain tile saying
// what it is where it cannot: a PDF, or an iPhone's HEIC before it has been
// converted on upload.
function Thumb({ item }: { item: StripItem }) {
  const [failed, setFailed] = useState(false);
  const image = item.mimeType.startsWith("image/") && !/hei[cf]/.test(item.mimeType);
  if (image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a local object URL or an authenticated archive route, neither of which next/image can optimise
      <img
        src={item.src}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    );
  }
  return (
    <span className="flex flex-col items-center gap-0.5 text-muted">
      <IconReceipt className="size-4" />
      <span className="text-[9px] font-semibold uppercase">
        {item.mimeType === "application/pdf" ? "PDF" : item.mimeType.split("/")[1]?.slice(0, 4)}
      </span>
    </span>
  );
}
