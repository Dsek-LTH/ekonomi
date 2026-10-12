// The Node.js server's boot check. Kept apart from instrumentation.ts because
// Next compiles that file for the Edge runtime as well, where `process.exit`
// does not exist. This module is only ever imported on the Node side.
import "server-only";

import { assertServerEnv } from "@/lib/server/env";

export function checkEnvironmentOrExit(): void {
  try {
    assertServerEnv();
  } catch (e) {
    // Throwing is not enough on its own: Next catches it, logs an unhandled
    // rejection and carries on listening, so the server stays up and answers
    // 500 to everything. A container that is up but broken is one a TCP health
    // check calls healthy, so exit instead. A non-zero exit is what makes the
    // orchestrator report a failed deploy rather than a running one.
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
