"use client";

// Frågor & svar, the guild's "HOW TO UTLÄGG" turned into something you can
// search at the register with your phone in one hand, instead of a PDF you have
// to remember you were sent. The text itself lives in
// messages/<locale>/faq-content/<category>.json (see faq-content.ts); this file
// is only how it reads and how you find it.
import { useMemo, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { IconChevronDown, IconReceipt } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";
import { searchText, type FaqBlock, type FaqItem, type FaqSection } from "./faq-content";

const ALL = "all";

// The anchor in the address bar, as state. Read through useSyncExternalStore
// rather than in an effect: the server has no location, and this is the API
// that lets the first client render agree with the server's and correct itself
// straight after, instead of hydrating wrong or flashing.
const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => decodeURIComponent(window.location.hash.slice(1));

export function FaqClient({ sections }: { sections: FaqSection[] }) {
  const t = useTranslations("faq");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  // Which questions have been clicked open or shut *against* what the page
  // would show on its own. See `isOpen`.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const hash = useSyncExternalStore(subscribeToHash, readHash, () => "");

  // One lowercased haystack per question, built once. The answers don't change
  // between keystrokes.
  const index = useMemo(
    () => sections.flatMap((s) => s.items.map((i) => [i.id, searchText(i)] as const)),
    [sections],
  );

  // Every term has to hit, in any order and anywhere in the answer, so "alkohol
  // pant" narrows rather than finding nothing. `null` means "not searching",
  // which is a different state from "searched and matched everything".
  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return null;
    return new Set(
      index.filter(([, text]) => terms.every((term) => text.includes(term))).map(([id]) => id),
    );
  }, [query, index]);

  // What a question does when nobody has touched it. A search is a question,
  // and a screen of collapsed headlines answers none of it, so a search opens
  // what it found. Failing that, /faq#deadline opens the answer it names, which
  // is what makes these anchors worth putting in a reminder mail.
  const opensItself = (id: string) => (matches ? matches.has(id) : hash === id);

  // Clicks are held as "differs from the default" rather than as the open set,
  // so clearing a search folds the page back up without a reset step. The key
  // carries the search and the anchor, so a click stops applying once the thing
  // it was a reaction to is gone.
  const clickKey = (id: string) => `${query}\u0000${hash}\u0000${id}`;
  const isOpen = (id: string) =>
    toggled.has(clickKey(id)) ? !opensItself(id) : opensItself(id);

  const toggle = (id: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      const key = clickKey(id);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const inCategory = (s: FaqSection) => category === ALL || s.id === category;
  const matched = (s: FaqSection) =>
    matches ? s.items.filter((i) => matches.has(i.id)) : s.items;

  const visible = sections
    .filter(inCategory)
    .map((s) => ({ ...s, items: matched(s) }))
    .filter((s) => s.items.length > 0);

  const hits = sections.reduce((n, s) => n + matched(s).length, 0);
  // What the line under the search field counts is what is on the screen, so it
  // doesn't claim five hits while a category chip is showing one of them.
  const shown = visible.reduce((n, s) => n + s.items.length, 0);

  // Counts only while searching. At rest they'd say how long each chapter is,
  // which is not a thing anyone came here to learn.
  const options = [
    { value: ALL, label: t("all"), badge: matches ? hits : undefined },
    ...sections.map((s) => ({
      value: s.id,
      label: s.label,
      badge: matches ? matched(s).length : undefined,
    })),
  ];

  return (
    <PageShell title={t("title")} width="content">
      <div className="space-y-3">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="sm:max-w-md"
        />
        {/* Which slice of the questions, so the underline register (the pills
            these were would have read as "which set of questions is this
            page about", which is not a choice this page offers. */}
        <div className="border-b border-border">
          <FilterTabs
            options={options}
            value={category}
            onChange={setCategory}
            aria-label={t("categories")}
          />
        </div>
        {matches && (
          <p aria-live="polite" className="text-xs text-muted">
            {t("matches", { count: shown })}
          </p>
        )}
      </div>

      {shown === 0 && (
        <EmptyState title={t("noMatchTitle")} description={t("noMatchDescription")} />
      )}

      {visible.map((section) => (
        <section key={section.id} className="space-y-3">
          <h2 className="text-xs font-medium text-muted">
            {section.label}
          </h2>
          {/* overflow-hidden so a hovered first or last question doesn't
              paint its background square over the card's corners. */}
          <Card className="divide-y divide-border overflow-hidden">
            {section.items.map((item) => (
              <Question
                key={item.id}
                item={item}
                open={isOpen(item.id)}
                onToggle={() => toggle(item.id)}
              />
            ))}
          </Card>
        </section>
      ))}
    </PageShell>
  );
}

function Question({
  item,
  open,
  onToggle,
}: {
  item: FaqItem;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `faq-${item.id}-answer`;
  // 200ms and the app's one easing (see DESIGN.md → Motion). The global
  // prefers-reduced-motion guard in globals.css cuts every duration here to
  // nothing, so the answer arrives instead of unfolding for anyone who asked
  // for that, no separate branch needed.
  const MOTION = "duration-200 ease-[var(--ease-out-quint)]";
  return (
    // The id is on the row, not the button: an anchor should land on the whole
    // question-and-answer, and it survives the button being re-rendered.
    <div id={item.id} className="scroll-mt-6">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start justify-between gap-4 px-inset py-4 text-left transition-colors hover:bg-hover"
      >
        <span className="text-[15px] font-medium">{item.q}</span>
        <IconChevronDown
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted transition-transform",
            MOTION,
            open && "rotate-180",
          )}
        />
      </button>
      {/* The answer stays mounted and is opened by animating the row it sits in
          from 0fr to 1fr, the one way to transition to a height nobody has
          measured, and it costs no JS and no ResizeObserver. A browser that
          won't interpolate `fr` still lands on the right two end states and
          just snaps between them.

          `inert` rather than an unmount: it takes the closed answer out of the
          tab order and the accessibility tree immediately, while the height is
          still on its way down, so nothing is reachable that isn't visible. */}
      <div
        id={panelId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity]",
          MOTION,
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        {/* Two wrappers, and both are load-bearing: the outer one is the grid
            row being animated and clips what overflows it, and the inner one
            carries the padding. On the outer, the bottom padding would keep a
            closed answer 20px tall. */}
        <div className="overflow-hidden">
          <div className="px-inset pb-5">
            <Answer blocks={item.a} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Answer({ blocks }: { blocks: FaqBlock[] }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-muted">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

const LIST = "ml-5 list-outside space-y-1.5";

// The answer's own tones, in the shared notice's terms.
const NOTE_TONE = { warn: "warning", danger: "danger" } as const;

function Block({ block }: { block: FaqBlock }) {
  switch (block.t) {
    case "p":
      return <p>{block.v}</p>;

    case "ul":
      return (
        <ul className={cn(LIST, "list-disc")}>
          {block.v.map((li, i) => (
            <li key={i}>{li}</li>
          ))}
        </ul>
      );

    case "ol":
      return (
        <ol className={cn(LIST, "list-decimal")}>
          {block.v.map((li, i) => (
            <li key={i}>{li}</li>
          ))}
        </ol>
      );

    case "note":
      return (
        <Notice tone={NOTE_TONE[block.tone]}>
          <p>{block.v}</p>
        </Notice>
      );

    case "table":
      return <AnswerTable head={block.head} rows={block.rows} />;

    case "link":
      // Absolute or `tel:`. An in-app destination is an `action` block, and
      // gets a button rather than a line of text.
      return (
        <p>
          <a href={block.href} className="font-medium text-accent underline decoration-faint underline-offset-2 hover:decoration-current">
            {block.v}
          </a>
        </p>
      );

    case "action":
      return (
        <p>
          <ButtonLink href={block.href} variant="secondary" size="sm">
            {block.v}
          </ButtonLink>
        </p>
      );

    case "image":
      return <ExamplePhoto block={block} />;
  }
}

function ExamplePhoto({ block }: { block: Extract<FaqBlock, { t: "image" }> }) {
  const t = useTranslations("faq");

  return (
    // Capped rather than full width: a receipt photographed portrait would
    // otherwise stand taller than the screen inside an answer, and you'd scroll
    // past the explanation to reach the picture it belongs to.
    <div className="relative aspect-[3/4] max-w-xs overflow-hidden rounded-panel border border-border bg-surface">
      {block.src ? (
        // The photo is contained, not cropped to fill: a cover crop cuts off the
        // footer, which is half of what these pictures are here to show. Full
        // size in a new tab for the details that survive neither.
        <a
          href={block.src}
          target="_blank"
          rel="noreferrer"
          title={t("openFull")}
          className="block size-full"
        >
          <Image
            src={block.src}
            alt={block.alt}
            fill
            sizes="320px"
            className="object-contain p-2"
          />
        </a>
      ) : (
        // Stands in until the photo exists, and says which file to add. This
        // page is maintained by whoever holds the treasury, and a frame that
        // renders nothing is a frame nobody knows how to fill.
        <div className="flex size-full flex-col items-center justify-center gap-2 p-5 text-center">
          <IconReceipt className="size-7 text-faint" />
          <p className="text-sm font-medium text-muted">{t("imageMissing")}</p>
          <code className="break-all text-xs leading-tight text-muted">
            {block.expected}
          </code>
        </div>
      )}
    </div>
  );
}

// Amounts line up here for the same reason they line up in every table in the
// app. Which column is money is worked out from the content rather than
// declared, so the translations stay plain data: a column is numeric when every
// cell in it is.
const NUMERIC = /^-?[\d\s]+([.,]\d+)?(\s*(kr|%|st))?$/i;

function AnswerTable({ head, rows }: { head: string[]; rows: string[][] }) {
  const numeric = head.map((_, col) => rows.every((row) => NUMERIC.test(row[col] ?? "")));
  const align = (col: number) => (numeric[col] ? "text-right tabular-nums" : "text-left");

  return (
    // The page column is narrow on a phone and a three-column table does not
    // fit in it; the table scrolls inside its own box rather than making the
    // page scroll sideways.
    <div className="overflow-x-auto overscroll-x-contain rounded-panel border border-border">
      <table className="w-full text-sm text-foreground">
        <thead>
          <tr className="border-b border-border text-xs font-medium text-muted">
            {head.map((h, i) => (
              <th key={i} className={cn("whitespace-nowrap px-3 py-2.5", align(i))}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className={cn("px-3 py-2.5", align(c))}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
