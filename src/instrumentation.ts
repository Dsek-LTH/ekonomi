// Runs once when a server instance boots (Next.js instrumentation hook).
//
// Its whole job is to fail a misconfigured production deploy immediately and
// loudly, rather than letting it come up healthy and break on whichever request
// first needs the missing variable. What counts as configured, and why a build
// is exempt, is lib/server/env.ts's business, not this file's.
export async function register() {
  // Next compiles this file for the Edge runtime too, and the check ends in
  // process.exit, which Edge has no notion of. The import is dynamic so that
  // code is only ever pulled into the Node bundle.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { checkEnvironmentOrExit } = await import("@/lib/server/startup");
  checkEnvironmentOrExit();
}
