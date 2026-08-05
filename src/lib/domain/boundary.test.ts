import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// lib/ is split by what the code touches: domain/ is pure rules, server/ talks
// to the database, the filesystem, the session. That split is only worth having
// while it holds, and it holds by convention — nothing in the type system stops
// someone importing Prisma into a domain module and quietly making the whole
// layer untestable. So it is checked here instead.
const here = dirname(fileURLToPath(import.meta.url));

const tsFilesIn = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
    .map((e) => join(dir, e.name));

// What a pure module may not reach for.
const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  { pattern: /["']server-only["']/, what: "server-only" },
  { pattern: /@\/lib\/server\//, what: "lib/server" },
  { pattern: /@\/lib\/data\//, what: "lib/data" },
  { pattern: /generated\/prisma/, what: "the Prisma client" },
  { pattern: /["']next\/navigation["']/, what: "next/navigation" },
  { pattern: /@\/auth["']/, what: "the auth config" },
];

const isPure = (file: string) => {
  const src = readFileSync(file, "utf8");
  return !FORBIDDEN.some(({ pattern }) => pattern.test(src));
};

describe.each(["domain", "ui"])("lib/%s stays pure", (folder) => {
  const files = tsFilesIn(join(here, "..", folder));

  it("has modules to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.split("/lib/")[1], f] as const))(
    "%s imports nothing that needs a server",
    (_label, file) => {
      const src = readFileSync(file, "utf8");
      for (const { pattern, what } of FORBIDDEN) {
        expect(pattern.test(src), `${_label} must not reach for ${what}`).toBe(false);
      }
    },
  );
});

// ── The mixed folders ─────────────────────────────────────────────
//
// budget/, ledger/ and fortnox/ are split by subject rather than by what they
// touch, so each holds both kinds: `eval.ts` is a formula engine and `access.ts`
// queries Postgres; `bas.ts` is the BAS chart and `report.ts` reads the ledger
// mirror. That is a reasonable way to keep a subject together, and it is why
// they are not simply added to the list above.
//
// What it costs is that nothing stops a pure module quietly acquiring a Prisma
// import from the impure one next to it — and a module that does is one nobody
// can unit-test again. So the named ones below are pinned: the list is the
// promise, and adding to it is how a new pure module gets the same protection.
const PINNED_PURE: Record<string, string[]> = {
  budget: ["changes.ts", "compare.ts", "eval.ts", "grid.ts", "index.ts"],
  ledger: ["bas.ts"],
  fortnox: ["oauth-state.ts", "sie.ts", "voucher-text.ts"],
};

describe.each(Object.entries(PINNED_PURE))("lib/%s: the pure half stays pure", (folder, names) => {
  it.each(names)("%s imports nothing that needs a server", (name) => {
    const file = join(here, "..", folder, name);
    const src = readFileSync(file, "utf8");
    for (const { pattern, what } of FORBIDDEN) {
      expect(pattern.test(src), `${folder}/${name} must not reach for ${what}`).toBe(false);
    }
  });

  // The other direction: a module that has *become* pure should be pinned, so
  // the list doesn't quietly fall behind what the folder actually holds.
  it("names every pure module in the folder", () => {
    const actual = tsFilesIn(join(here, "..", folder))
      .filter(isPure)
      .map((f) => f.split("/").pop()!)
      .sort();
    expect(actual).toEqual([...names].sort());
  });
});
