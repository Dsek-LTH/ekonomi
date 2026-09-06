// The two message files, held to each other and to the app.
//
// Two failure modes, both of which happened and neither of which anything
// noticed. A key added to one language and not the other reads as the key
// itself on screen, in the middle of a sentence, for whoever is in the other
// language. And a key whose call site was deleted simply stays: eighteen of
// them had accumulated, which is eighteen strings a translator maintains for
// nobody.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import sv from "../../messages/sv.json";

type Tree = { [k: string]: string | Tree };

/** Every leaf, as its full dotted path. */
function flatten(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === "string" ? [path] : flatten(v, path);
  });
}

const SRC = join(process.cwd(), "src");

/** Every hand-written source file, read once. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    // Prisma's output is generated and mentions no message key.
    if (e.isDirectory()) return e.name === "generated" ? [] : sources(p);
    return /\.tsx?$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
  });
}

const CODE = sources(SRC).join("\n");

/**
 * Keys built at the call site rather than written out, which no textual search
 * can find. Each is a prefix: everything under it is exempt.
 *
 * Kept deliberately short. A key that has to be listed here is a key nothing
 * can check, so the cost of adding one is meant to be visible.
 */
const DYNAMIC = [
  // `tCap(`${capability}_hint`)` in admin/roles/roles-client.tsx.
  "common.capability.",
  // `t(`step${n}Title`)` over [1,2,3,4] in dashboard/dashboard-client.tsx.
  "dashboard.firstRun.step",
  // `resultUnit.prefix_${c.kind}` in lib/server/result-units.ts.
  "errors.resultUnit.prefix_",
  // Status and enum names, resolved from the value: `common.status.${status}`,
  // `income.status.${status}`, `tEvent(r.action)` over ExpenseEventType in
  // expenses/[id]/detail-sections.tsx, and the export-step codes both export
  // routes word from `errors.<domain>.exportStep.<step>`.
  //
  // These are the keys this test cannot see, and one of them had already gone
  // stale: `expenses.event.REJECTED` outlived the status by a migration. Their
  // safety net is the enum itself, not this test.
  "common.status.",
  "income.status.",
  "expenses.event.",
  "errors.expense.exportStep.",
  "errors.income.exportStep.",
];

const dynamic = (key: string) => DYNAMIC.some((p) => key.startsWith(p));

describe("messages", () => {
  const enKeys = flatten(en as Tree);
  const svKeys = flatten(sv as Tree);

  it("has the same keys in both languages", () => {
    expect([...enKeys].sort()).toEqual([...svKeys].sort());
  });

  it("has no key the app never asks for", () => {
    // The leaf is what a call site writes, since `useTranslations("a.b")` puts
    // the namespace in one place and the leaf in another. Matched as a quoted
    // string or as a template/property fragment, which between them cover every
    // way this app names one.
    const unused = svKeys.filter((key) => {
      if (dynamic(key)) return false;
      const leaf = key.split(".").pop()!;
      return !new RegExp(`["'\`.]${leaf}\\b`).test(CODE);
    });
    expect(unused).toEqual([]);
  });
});
