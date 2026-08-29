import { cookies } from "next/headers";
import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/current-user";
import { canLogInToFortnox } from "@/lib/domain/permissions";
import { getFortnoxSession } from "@/lib/data/fortnox";
import { THEME_COOKIE, parseTheme } from "@/lib/ui/theme";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage() {
  const user = await requireUser();

  // The only place the treasury's own Fortnox login is read for display — the
  // sidebar no longer carries a copy of it.
  const showsFortnox = canLogInToFortnox(user.capabilities);
  const [payout, fortnoxSession, cookieStore] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { bankClearingNumber: true, bankAccountNumber: true },
    }),
    showsFortnox ? getFortnoxSession(user.id) : null,
    cookies(),
  ]);

  return (
    <ProfileClient
      name={user.name}
      email={user.email}
      roles={user.roles}
      clearing={payout?.bankClearingNumber ?? ""}
      account={payout?.bankAccountNumber ?? ""}
      fortnox={showsFortnox ? { session: fortnoxSession } : undefined}
      theme={parseTheme(cookieStore.get(THEME_COOKIE)?.value)}
    />
  );
}
