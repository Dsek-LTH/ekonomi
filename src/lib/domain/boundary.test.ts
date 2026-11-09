import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// lib/ is split by what the code touches: domain/ is pure rules, server/ talks to the database, filesystem and session. Checked here because nothing in the type system enforces it.
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
  // The client, but not `generated/prisma/enums`: only the schema's enums, no imports or engine (lib/domain/types.ts derives its unions from it).
  { pattern: /generated\/prisma(?!\/enums)/, what: "the Prisma client" },
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

// budget/, ledger/ and fortnox/ hold both pure and impure modules, so the pure ones are pinned by name. Adding to the list is how a new pure module gets the same protection.
const PINNED_PURE: Record<string, string[]> = {
  // inputs.ts and payload.ts are shared across the boundary: they must run in the browser.
  budget: [
    "changes.ts",
    "compare.ts",
    "eval.ts",
    "grid.ts",
    "index.ts",
    "inputs.ts",
    "overview.ts",
    "paste.ts",
    "payload.ts",
  ],
  // report-shape.ts and cost-center-filter.ts are imported by browser code.
  ledger: ["bas.ts", "cost-center-filter.ts", "report-shape.ts"],
  // These are run in the browser, so they must stay reachable from a client component.
  contract: [
    "availability.ts",
    "document-url.ts",
    "file-roles.ts",
    "rental-state.ts",
    "section.ts",
    "signatory.ts",
    "status.ts",
    "tags.ts",
  ],
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

  // The other direction: a module that has become pure should be pinned.
  it("names every pure module in the folder", () => {
    const actual = tsFilesIn(join(here, "..", folder))
      .filter(isPure)
      .map((f) => f.split("/").pop()!)
      .sort();
    expect(actual).toEqual([...names].sort());
  });
});
