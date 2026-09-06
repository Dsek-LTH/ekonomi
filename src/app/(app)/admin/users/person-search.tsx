"use client";

// A person picker that queries the server as you type. The section has on the
// order of a thousand members, so the candidate list is never shipped to the
// browser, only what a query actually matches.
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { useDismissOnOutside } from "@/lib/ui/dismiss";
import { useQuery } from "@/components/shell/use-query";
import { cn } from "@/lib/ui/utils";
import type { User } from "@/lib/domain/types";

export function PersonSearch({
  onSelect,
  placeholder,
  exclude = [],
  className,
  autoFocus,
}: {
  onSelect: (user: User) => void;
  placeholder?: string;
  exclude?: string[]; // user ids already in the list this feeds
  className?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations("admin.users");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced, and the previous results stay on screen while the next request
  // is in flight: a list that emptied itself between keystrokes would flicker
  // through every prefix of what is being typed. The abort inside `useQuery` is
  // what stops a slower earlier response landing on top of a newer one.
  const q = query.trim();
  const { data, loading } = useQuery<{ users: User[] }>(
    q ? `/api/users?q=${encodeURIComponent(q)}` : null,
    { debounceMs: 200 },
  );
  const results = data?.users ?? [];

  useDismissOnOutside(open, boxRef, () => setOpen(false));

  // Derived rather than stored, so clearing the field needs no state update.
  const shown = query.trim() ? results.filter((u) => !exclude.includes(u.id)) : [];

  function pick(user: User) {
    onSelect(user);
    // Clearing the field is enough: `shown` derives to [] from an empty query,
    // and the hook stops fetching once there is no url to fetch.
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <SearchInput
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && shown.length === 1) pick(shown[0]);
        }}
        placeholder={placeholder ?? t("searchPlaceholder")}
      />

      {/* In the field rather than only in the panel below: the panel shows the
          previous query's matches while a new one is in flight, so without this
          a stale list looks like the answer. The field is h-9 at the top of
          this wrapper, hence the centre at 18px. */}
      {loading && (
        <Spinner
          size="sm"
          className="pointer-events-none absolute right-2.5 top-[18px] -translate-y-1/2 text-muted"
        />
      )}

      {open && query.trim() && (
        <div className="absolute z-40 mt-1 w-full min-w-64 overflow-hidden rounded-xl border border-border bg-background shadow-[var(--shadow-pop)]">
          {loading && shown.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
              <Spinner size="sm" />
              {t("searching")}
            </p>
          ) : shown.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">{t("noMatch")}</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto p-1">
              {shown.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => pick(u)}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover"
                  >
                    <Avatar initials={u.initials} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{u.name}</span>
                      <span className="block truncate text-xs text-muted">{u.email}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
