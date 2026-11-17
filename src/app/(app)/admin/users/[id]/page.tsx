import { notFound } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getUserAuthority } from "@/lib/data/authority";
import {
  canAccessSettings,
  canBookkeep,
  canGrantAccess,
  canSeeUsers,
} from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";
import { PersonClient } from "./person-client";

export const generateMetadata = titled("users");

export default async function AdminPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage(canSeeUsers);
  const { id } = await params;
  const authority = await getUserAuthority(id);
  if (!authority) notFound();

  return (
    <PageShell title={authority.user.name} subtitle={authority.user.email} back="/admin/users">
      <PersonClient
        key={authority.user.id}
        authority={authority}
        canGrant={canGrantAccess(user.capabilities)}
        canSettings={canAccessSettings(user.capabilities)}
        canSeePayout={canBookkeep(user.capabilities)}
      />
    </PageShell>
  );
}
