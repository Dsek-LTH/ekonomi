import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
const src = resolve(root, "src");

// Unit tests for the domain logic: the money conversions, the attest authority
// matrix, the submit gate, the budget formula engine, the bank parser and the
// rule deciding who may see which utlägg. Everything under test is a plain
// function over plain data, so `pnpm test` runs in under a second and can be
// trusted in a pre-commit hook or in CI.
//
// Anything that actually queries (lib/data/*'s loaders, lib/ledger/report.ts)
// is deliberately out of scope. Testing those means standing up Postgres,
// which is a different kind of test with a different budget.
//
// Route handlers are in scope, and were the gap this rule accidentally left. A
// handler is an ordinary async function over a Request; what needs a world is
// not the handler but the two things beneath it: the session and the database,
// and both can be replaced at their lowest point (`lib/server/current-user`
// and `lib/server/db`), leaving everything above them real: the actual gate,
// the actual schema, the actual response. See
// app/api/authority/capabilities/route.test.ts for the shape. It matters
// because every authority gate in the app is a route handler, and testing only
// the pure layer underneath meant testing the half that was not breaking.
export default defineConfig({
  test: {
    environment: "node",
    // lib/ is where most of it is, but the rule is what a test *is* here, not
    // where it sits: a plain function over plain data. The budget screen's
    // local patches (app/(app)/budget/[budgetId]/patch-budget.ts) are exactly
    // that, and they restate what a route does, which is the kind of thing
    // that has to be held to it.
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // `server-only` throws on import outside a React Server Component. The
      // modules that guard themselves with it hold logic worth testing (the
      // expense scope, above all), and importing one here is not the mistake
      // the package exists to catch, so it resolves to nothing under test.
      "server-only": resolve(src, "lib/test/server-only-stub.ts"),
      // Mirrors the `@/*` path alias in tsconfig.json, which points into src/.
      "@": src,
    },
  },
});
