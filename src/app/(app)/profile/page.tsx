import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/current-user";
import { canBookkeep, canLogInToFortnox, hasAttestRole, isAdmin } from "@/lib/domain/permissions";
import { AUDIENCE, SWITCHABLE_KINDS, wants } from "@/lib/domain/notifications";
import { userHoldsCard } from "@/lib/data/users";
import { getFortnoxSession } from "@/lib/data/fortnox";
import { getMemberScore } from "@/lib/data/member-score";
import { ProfileClient } from "./profile-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("profile");

export default async function ProfilePage() {
  const user = await requireUser();

  // The only place the treasury's own Fortnox login is read for display.
  const showsFortnox = canLogInToFortnox(user.capabilities);
  const [payout, fortnoxSession, holdsCard, saved, score] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { bankClearingNumber: true, bankAccountNumber: true, avatarKey: true },
    }),
    showsFortnox ? getFortnoxSession(user.id) : null,
    userHoldsCard(user.id),
    prisma.notificationPreference.findMany({
      where: { userId: user.id },
      select: { kind: true, enabled: true },
    }),
    getMemberScore(user.id),
  ]);

  // Only emails this member could actually be sent.
  const reaches = {
    everyone: true,
    attesters: hasAttestRole(user.capabilities) || isAdmin(user.capabilities),
    bookkeepers: canBookkeep(user.capabilities),
    cardHolders: holdsCard,
  };
  const choices = new Map(saved.map((p) => [p.kind, p.enabled]));
  const notifications = SWITCHABLE_KINDS.filter((kind) => reaches[AUDIENCE[kind]]).map((kind) => ({
    kind,
    enabled: wants(kind, choices),
  }));

  return (
    <ProfileClient
      userId={user.id}
      hasAvatar={!!payout?.avatarKey}
      name={user.name}
      email={user.email}
      roles={user.roles}
      clearing={payout?.bankClearingNumber ?? ""}
      account={payout?.bankAccountNumber ?? ""}
      fortnox={showsFortnox ? { session: fortnoxSession } : undefined}
      notifications={notifications}
      score={score}
    />
  );
}
