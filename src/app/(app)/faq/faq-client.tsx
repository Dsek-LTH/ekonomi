"use client";

// Frågor & svar: the guild's "HOW TO UTLÄGG", searchable. The text lives in messages/<locale>/faq-content/<category>.json (see faq-content.ts).
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

// The anchor in the address bar, via useSyncExternalStore: the server has no location, and this lets the first client render agree with the server's.
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

  const index = useMemo(
    () => sections.flatMap((s) => s.items.map((i) => [i.id, searchText(i)] as const)),
    [sections],
  );

  // Every term has to hit, in any order. `null` means not searching, which differs from matched everything.
  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return null;
    return new Set(
      index.filter(([, text]) => terms.every((term) => text.includes(term))).map(([id]) => id),
    );
  }, [query, index]);

  // A search opens what it found. Failing that, /faq#deadline opens the answer it names (anchors used in reminder mails).
  const opensItself = (id: string) => (matches ? matches.has(id) : hash === id);

  // Clicks are held as "differs from the default", keyed on the search and anchor, so clearing a search folds the page back without a reset.
  const clickKey = (id: string) => `${query}\u0000${hash}\u0000${id}`;
  const isOpen = (id: string) => (toggled.has(clickKey(id)) ? !opensItself(id) : opensItself(id));

  const toggle = (id: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      const key = clickKey(id);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const inCategory = (s: FaqSection) => category === ALL || s.id === category;
  const matched = (s: FaqSection) => (matches ? s.items.filter((i) => matches.has(i.id)) : s.items);

  const visible = sections
    .filter(inCategory)
    .map((s) => ({ ...s, items: matched(s) }))
    .filter((s) => s.items.length > 0);

  const hits = sections.reduce((n, s) => n + matched(s).length, 0);
  // The count is what is on screen, not all hits.
  const shown = visible.reduce((n, s) => n + s.items.length, 0);

  // Counts only while searching.
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
          <h2 className="text-xs font-medium text-muted">{section.label}</h2>
          {/* overflow-hidden so a hovered first or last question doesn't paint square over the card's corners. */}
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
  // 200ms and the app's one easing (DESIGN.md, Motion). The prefers-reduced-motion guard in globals.css handles reduced motion.
  const MOTION = "duration-200 ease-[var(--ease-out-quint)]";
  return (
    // The id is on the row so an anchor lands on the whole question-and-answer.
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
      {/* Opened by animating the row from 0fr to 1fr (no JS, no ResizeObserver). `inert` rather than unmount takes the closed answer out of tab order and the accessibility tree at once. */}
      <div
        id={panelId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity]",
          MOTION,
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        {/* Two wrappers, both load-bearing: the outer is the animated grid row and clips overflow, the inner carries the padding (on the outer it would keep a closed answer 20px tall). */}
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
          <a
            href={block.href}
            className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
          >
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
    // Capped, or a portrait receipt photo would stand taller than the screen inside an answer.
    <div className="relative aspect-[3/4] max-w-xs overflow-hidden rounded-panel border border-border bg-surface">
      {block.src ? (
        // Contained, not cropped: a cover crop cuts off the footer. Full size in a new tab.
        <a
          href={block.src}
          target="_blank"
          rel="noreferrer"
          title={t("openFull")}
          className="relative block size-full"
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
        // Stands in until the photo exists, and says which file to add.
        <div className="flex size-full flex-col items-center justify-center gap-2 p-5 text-center">
          <IconReceipt className="size-7 text-faint" />
          <p className="text-sm font-medium text-muted">{t("imageMissing")}</p>
          <code className="break-all text-xs leading-tight text-muted">{block.expected}</code>
        </div>
      )}
    </div>
  );
}

// Which column is money is worked out from the content: numeric when every cell is.
const NUMERIC = /^-?[\d\s]+([.,]\d+)?(\s*(kr|%|st))?$/i;

function AnswerTable({ head, rows }: { head: string[]; rows: string[][] }) {
  const numeric = head.map((_, col) => rows.every((row) => NUMERIC.test(row[col] ?? "")));
  const align = (col: number) => (numeric[col] ? "text-right tabular-nums" : "text-left");

  return (
    // The table scrolls inside its own box rather than making the page scroll sideways.
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
