import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
const src = resolve(root, "src");

// Unit tests for the domain logic — the money conversions, the attest authority
// matrix, the submit gate, the budget formula engine, the bank parser and the
// rule deciding who may see which utlägg. Everything under test is a plain
// function over plain data, so `pnpm test` runs in under a second and can be
// trusted in a pre-commit hook or in CI.
//
// Anything that actually queries (lib/data/*'s loaders, lib/ledger/report.ts)
// is deliberately out of scope — testing those means standing up Postgres,
// which is a different kind of test with a different budget.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // `server-only` throws on import outside a React Server Component. The
      // modules that guard themselves with it hold logic worth testing (the
      // expense scope, above all), and importing one here is not the mistake
      // the package exists to catch — so it resolves to nothing under test.
      "server-only": resolve(src, "lib/test/server-only-stub.ts"),
      // Mirrors the `@/*` path alias in tsconfig.json, which points into src/.
      "@": src,
    },
  },
});
