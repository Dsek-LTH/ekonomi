// The Node.js server's boot check. Kept apart from instrumentation.ts because
// Next compiles that file for the Edge runtime as well, where `process.exit`
// does not exist. This module is only ever imported on the Node side.
import "server-only";

import { assertServerEnv } from "@/lib/server/env";

export function checkEnvironmentOrExit(): void {
  try {
    assertServerEnv();
  } catch (e) {
    // Throwing is not enough: Next logs it and keeps listening (a TCP health check calls that healthy), so exit non-zero.
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
