"use client";

// The events, as a timeline.
//
// A night is a thing rather than a label on a movement: you make one, open it,
// and register against it. So it needs a place to be listed, and the list's
// job is to get somebody into the right one: the pub they ran last night is
// almost always the top one. That one is tinted and carries the way back into
// its sheet; the rest are rows under their month, read top to bottom in the
// order they happened. They were cards three to a row, which the eye had to
// zigzag through to find a date, each with the same calendar icon saying
// nothing.
//
// What a row says about a night is its arithmetic, because there is nothing
// else to say. There is no status: an event is never closed and never
// finished, and nothing here can say whether a night is done. A row used to
// carry a "still out" badge that meant to, but its condition was
// `out > back + spilled`, which is the definition of the sold figure standing
// beside it, so it lit on every night that sold anything. Telling the two
// apart needs something the log does not record.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyNote } from "@/components/ui/empty-state";
import { IconChevronRight, IconPlus } from "@/components/ui/icons";
import { SearchInput } from "@/components/ui/search-input";
import type { StockEventDto } from "@/lib/data/stock";
import { formatOreKr } from "@/lib/ui/format";
import { cn } from "@/lib/ui/utils";
import { EventDialog } from "./event-dialog";

/** Noon, so no time zone can move a stored day onto its neighbour. */
const dayOf = (iso: string) => new Date(`${iso}T12:00:00`);

export default function EventsClient({
  events,
  canManage,
}: {
  events: StockEventDto[];
  canManage: boolean;
}) {
  const t = useTranslations("stock");
  const locale = useLocale();
  const [making, setMaking] = useState(false);
  const [query, setQuery] = useState("");

  const fmt = useMemo(
    () => ({
      month: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: "short" }),
    }),
    [locale],
  );

  // Newest first, as they arrive (lib/data/stock.ts orders them so).
  const latestId = events[0]?.id;
  const q = query.trim().toLowerCase();

  /** The shown nights under their month, in the order they arrive. */
  const months = useMemo(() => {
    const out: { key: string; label: string; events: StockEventDto[] }[] = [];
    for (const e of events) {
      if (q && !e.name.toLowerCase().includes(q) && !e.date.includes(q)) continue;
      const key = e.date.slice(0, 7);
      const last = out[out.length - 1];
      if (last?.key === key) last.events.push(e);
      else {
        const label = fmt.month.format(dayOf(e.date));
        out.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1), events: [e] });
      }
    }
    return out;
  }, [events, q, fmt]);

  const figures = (e: StockEventDto) =>
    e.products === 0 ? t("event.noneBooked") : t("counts.products", { count: e.products });

  const newButton = canManage && (
    <Button onClick={() => setMaking(true)}>
      <IconPlus className="size-4" />
      {t("event.new")}
    </Button>
  );

  return (
    <PageShell title={t("event.title")} width="content">
      {/* The list's own frame even with nothing in it: the search and the way
          to make the first one stay where they always are. */}
      <>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <SearchInput
              placeholder={t("event.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="ml-auto">{newButton}</div>
        </div>

        {months.length > 0 ? (
          <Card className="divide-y divide-border overflow-hidden">
            {months.map((m) => (
              <section key={m.key}>
                <h2 className="border-b border-border bg-surface/60 px-inset py-1.5 text-xs font-medium text-muted">
                  {m.label}
                </h2>
                <ul className="divide-y divide-border">
                  {m.events.map((e) => {
                    const latest = !q && e.id === latestId;
                    const day = dayOf(e.date);
                    return (
                      <li key={e.id} className={cn("relative", latest && "bg-accent-soft/30")}>
                        <div className="flex items-center gap-4 px-inset py-3">
                          {/* The day as a block, so the column of them reads
                              as a calendar down the left. */}
                          <span className="flex w-10 shrink-0 flex-col items-center leading-none">
                            <span className="text-lg font-semibold tabular-nums">{day.getDate()}</span>
                            <span className="mt-1 text-xs text-muted">{fmt.weekday.format(day)}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            {/* The whole row is the link: the name's own
                                hit area is stretched over it. */}
                            <Link
                              href={`/stock/events/${e.id}`}
                              className="block truncate font-medium after:absolute after:inset-0 after:content-[''] hover:underline"
                            >
                              {e.name}
                            </Link>
                            <span className="block text-xs text-muted tabular-nums">{figures(e)}</span>
                          </span>
                          {e.soldValueOre > 0 && (
                            <span className="shrink-0 text-sm tabular-nums">
                              {formatOreKr(e.soldValueOre)}
                            </span>
                          )}
                          {latest ? (
                            // Above the stretched link, so it is its own
                            // target rather than the row's. On a phone the
                            // tinted row is the button.
                            <span className="relative z-10 hidden shrink-0 sm:block">
                              <ButtonLink href={`/stock/events/${e.id}`} size="sm">
                                {canManage ? t("event.continue") : t("event.open")}
                                <IconChevronRight className="size-4" />
                              </ButtonLink>
                            </span>
                          ) : (
                            <IconChevronRight className="size-4 shrink-0 text-muted" />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </Card>
        ) : (
          <Card>
            <EmptyNote size="page">{events.length === 0 ? t("event.empty") : t("event.noMatch")}</EmptyNote>
          </Card>
        )}
      </>

      {making && <EventDialog onClose={() => setMaking(false)} />}
    </PageShell>
  );
}
