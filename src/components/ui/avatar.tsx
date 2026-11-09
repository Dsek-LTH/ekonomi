"use client";

import { createContext, useContext, useState } from "react";
import { cn } from "@/lib/ui/utils";
import { initials as initialsOf } from "@/lib/ui/format";

// Size is a prop because cn() only joins, so two `size-` utilities are settled by emission order.
const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  xl: "size-24 text-2xl",
} as const;

export type AvatarSize = keyof typeof SIZES;

function Avatar({
  initials,
  src,
  size = "sm",
  className,
}: {
  initials: string;
  src?: string;
  size?: AvatarSize;
  className?: string;
}) {
  // A failing picture falls back to initials; keyed on src so a new picture gets a chance.
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

/** Members with a picture, id to version. Loaded once by the app layout (getAvatarVersions). */
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
function useAvatarSrc(userId: string | null | undefined): string | undefined {
  const versions = useContext(AvatarVersions);
  const v = userId ? versions[userId] : undefined;
  return v ? `/api/users/${userId}/avatar?v=${v}` : undefined;
}

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
  return (
    <Avatar
      initials={initialsOf(name)}
      src={useAvatarSrc(userId)}
      size={size}
      className={className}
    />
  );
}

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
