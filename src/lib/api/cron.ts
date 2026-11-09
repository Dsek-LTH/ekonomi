// Gate for scheduled jobs, called by a k8s CronJob with CRON_SECRET as a bearer token. Unset means the jobs are off and
// answer 404, so no job is reachable without a secret.
import "server-only";

import { timingSafeEqual } from "node:crypto";
import { fail } from "@/lib/api/guard";
import type { NextResponse } from "next/server";

export function cronGate(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(404, "notFound");
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return fail(401, "auth.denied");
  }
  return null;
}
