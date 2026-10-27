// Sync the project list from Fortnox into the local Project table.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { syncProjects } from "@/lib/fortnox/sync";
import { fortnoxFailure, gateFortnoxService } from "@/lib/api/fortnox-route";

export async function POST() {
  const g = await gateFortnoxService(canAccessSettings, "auth.adminSyncProjects");
  if (!g.ok) return g.res;

  try {
    const result = await syncProjects(g.token);
    const total = await prisma.project.count();
    return NextResponse.json({ ...result, total });
  } catch (e) {
    return fortnoxFailure(e, {
      forbidden: "fortnox.missingProjectScope",
      fallback: "fortnox.syncFailed",
    });
  }
}
