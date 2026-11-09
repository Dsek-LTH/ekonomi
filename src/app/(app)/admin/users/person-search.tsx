"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { UserAvatar } from "@/components/ui/avatar";
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
  exclude?: string[];
  className?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations("admin.users");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const { data, loading } = useQuery<{ users: User[] }>(
    q ? `/api/users?q=${encodeURIComponent(q)}` : null,
    { debounceMs: 200 },
  );
  const results = data?.users ?? [];

  useDismissOnOutside(open, boxRef, () => setOpen(false));

  const shown = query.trim() ? results.filter((u) => !exclude.includes(u.id)) : [];

  function pick(user: User) {
    onSelect(user);
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

      {loading && (
        <Spinner
          size="sm"
          className="pointer-events-none absolute right-2.5 top-[18px] -translate-y-1/2 text-muted"
        />
      )}

      {open && query.trim() && (
        <div className="absolute z-40 mt-1 w-full min-w-64 overflow-hidden rounded-panel border border-border bg-background shadow-[var(--shadow-pop)]">
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
                    className="flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left transition-colors hover:bg-hover"
                  >
                    <UserAvatar userId={u.id} name={u.name} />
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
