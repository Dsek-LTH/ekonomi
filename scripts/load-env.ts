// Loads .env for the things that run outside `next dev` / `next start`: the
// Prisma config, the seed, and the maintenance scripts in this directory. Next
// reads .env itself; tsx and the Prisma CLI do not, so these have to ask.
//
// A missing file is not an error. In a container there is no .env, the
// environment is handed to the process by Docker or Kubernetes, and
// `process.loadEnvFile` throwing ENOENT there would fail a migration for the
// one reason that is not a problem.
export function loadEnvFile(path = ".env"): void {
  try {
    process.loadEnvFile?.(path);
  } catch {
    // No .env: whatever is already in process.env is the configuration.
  }
}
