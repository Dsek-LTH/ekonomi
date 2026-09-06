import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/current-user";
import { canLogInToFortnox } from "@/lib/domain/permissions";
import { getFortnoxSession } from "@/lib/data/fortnox";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage() {
  const user = await requireUser();

  // The only place the treasury's own Fortnox login is read for display. The
  // sidebar no longer carries a copy of it.
  const showsFortnox = canLogInToFortnox(user.capabilities);
  const [payout, fortnoxSession] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { bankClearingNumber: true, bankAccountNumber: true },
    }),
    showsFortnox ? getFortnoxSession(user.id) : null,
  ]);

  return (
    <ProfileClient
      name={user.name}
      email={user.email}
      roles={user.roles}
      clearing={payout?.bankClearingNumber ?? ""}
      account={payout?.bankAccountNumber ?? ""}
      fortnox={showsFortnox ? { session: fortnoxSession } : undefined}
    />
  );
}
