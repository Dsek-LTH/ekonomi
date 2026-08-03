import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/current-user";
import { canLogInToFortnox } from "@/lib/domain/permissions";
import { getFortnoxSession } from "@/lib/data/fortnox";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage() {
  const user = await requireUser();

  // Everything the sidebar's profile popover shows also lives here, plus what's
  // too big for a popover — payout account and the full Fortnox controls.
  const showsFortnox = canLogInToFortnox(user.roles);
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
