import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getAuthority } from "@/lib/data/authority";
import { RolesClient } from "./roles-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("roles");

export default async function AdminRolesPage() {
  const user = await requirePage(canAccessSettings);
  const authority = await getAuthority();

  return <RolesClient {...authority} viewerRoles={user.roles} />;
}
