// Fails a misconfigured production deploy at boot (what counts is decided in lib/server/env.ts).
export async function register() {
  // Edge has no process.exit, so the import is dynamic to keep it out of the Edge bundle.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { checkEnvironmentOrExit } = await import("@/lib/server/startup");
  checkEnvironmentOrExit();
}
