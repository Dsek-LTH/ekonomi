"use client";

import { createContext, useContext, useState } from "react";
import { cn } from "@/lib/ui/utils";
import { initials as initialsOf } from "@/lib/ui/format";

// A person, as a round mark: their profile picture, or their initials when
// they have none. Sizes are a prop rather than a class from the caller because
// cn() only joins, and two `size-` utilities are settled by emission order.
const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  xl: "size-24 text-2xl",
} as const;

export type AvatarSize = keyof typeof SIZES;

export function Avatar({
  initials,
  src,
  size = "sm",
  className,
}: {
  initials: string;
  /** The picture. Left out, or failing to load, the initials are drawn. */
  src?: string;
  size?: AvatarSize;
  className?: string;
}) {
  // A picture that fails (removed a moment ago, storage down) falls back to
  // the initials rather than the browser's broken-image glyph. Keyed on the
  // src, so a new picture gets its own chance.
  const [failed, setFailed] = useState<string | null>(null);
  const shown = src && failed !== src;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface font-semibold text-muted",
        SIZES[size],
        className,
      )}
    >
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(src)} />
      ) : (
        initials
      )}
    </span>
  );
}

/**
 * Which members have a picture, as id to version. Loaded once by the app
 * layout (getAvatarVersions), so a list can draw a face beside every name
 * without each query having to carry it. A member who is not in it has none.
 */
const AvatarVersions = createContext<Record<string, number>>({});

export function AvatarProvider({
  versions,
  children,
}: {
  versions: Record<string, number>;
  children: React.ReactNode;
}) {
  return <AvatarVersions.Provider value={versions}>{children}</AvatarVersions.Provider>;
}

/** A member's picture URL, versioned so a new one is never read from cache. */
export function useAvatarSrc(userId: string | null | undefined): string | undefined {
  const versions = useContext(AvatarVersions);
  const v = userId ? versions[userId] : undefined;
  return v ? `/api/users/${userId}/avatar?v=${v}` : undefined;
}

/** A member's avatar by id and name: the picture if they have one. */
export function UserAvatar({
  userId,
  name,
  size,
  className,
}: {
  userId: string | null | undefined;
  name: string;
  size?: AvatarSize;
  className?: string;
}) {
  return <Avatar initials={initialsOf(name)} src={useAvatarSrc(userId)} size={size} className={className} />;
}

/**
 * A name with the member's face before it, for a name inside a line of text: a
 * history row, a table cell, a subtitle. The picture is drawn only when they
 * have one, so a list of people without pictures reads exactly as plain names
 * did rather than as a column of grey initials.
 */
export function PersonName({
  userId,
  name,
  className,
}: {
  userId: string | null | undefined;
  name: string;
  className?: string;
}) {
  const src = useAvatarSrc(userId);
  if (!src) return <span className={className}>{name}</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 align-bottom", className)}>
      <Avatar initials={initialsOf(name)} src={src} size="xs" />
      <span className="truncate">{name}</span>
    </span>
  );
}
