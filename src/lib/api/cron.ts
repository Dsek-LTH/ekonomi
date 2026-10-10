// The gate for scheduled jobs. They are called by a k8s CronJob rather than a
// signed-in member, so there is no session to check: the caller presents
// CRON_SECRET as a bearer token instead.
//
// Unset CRON_SECRET means the jobs are off, and they answer 404 as though they
// did not exist. A job reachable without a secret would let anyone on the
// internet mail the whole section.
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
