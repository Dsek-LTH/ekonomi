// Every step finds what it points at and has its words. A step with a missing `data-tour` target is
// skipped silently at runtime (components/shell/guide.tsx), so a dropped attribute would go unnoticed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDES, GUIDE_IDS } from "./guides";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : sources(p);
    return /\.tsx$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
  });
}

const CODE = sources(join(process.cwd(), "src")).join("\n");
const anchors = new Set([...CODE.matchAll(/data-tour="([^"]+)"/g)].map((m) => m[1]));

// Some anchors are named from a value at the call site (`data-tour={`tab:${opt.value}`}`) and count as
// there; the value itself must still be written somewhere (a tab's `value`, a group's `label`).
const PREFIXES = [...CODE.matchAll(/data-tour=\{`([a-z-]+:)\$\{/g)].map((m) => m[1]);
const exists = (name: string) =>
  anchors.has(name) ||
  PREFIXES.some((p) => name.startsWith(p) && CODE.includes(`"${name.slice(p.length)}"`));

describe("guides", () => {
  it("has one guide per page", () => {
    expect(new Set(GUIDES.map((g) => g.page)).size).toBe(GUIDES.length);
  });

  it("lists every id once", () => {
    expect(GUIDES.map((g) => g.id).sort()).toEqual([...GUIDE_IDS].sort());
  });

  it("points only at anchors that exist", () => {
    const missing = GUIDES.flatMap((g) =>
      g.steps
        .filter((s) => s.target && !exists(s.target))
        .map((s) => `${g.id}.${s.key} -> ${s.target}`),
    );
    expect(missing).toEqual([]);
  });

  it("has a title and a body for every step, in both languages", () => {
    for (const locale of ["sv", "en"]) {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), "messages", locale, "guides.json"), "utf8"),
      );
      const missing = GUIDES.flatMap((g) =>
        g.steps.flatMap((s) =>
          ["title", "body"]
            .filter((k) => !messages[g.id]?.[s.key]?.[k])
            .map((k) => `${locale}: ${g.id}.${s.key}.${k}`),
        ),
      );
      expect(missing).toEqual([]);
    }
  });
});
