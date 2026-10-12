// Corners come in three sizes and this is what keeps it that way.
//
// globals.css clears Tailwind's radius scale and puts `mark`, `control` and
// `panel` in its place (the block under "Corners" says which is which). A
// `rounded-lg` written after that compiles to nothing, so the element quietly
// goes square and nobody is told. This turns it into a red test instead, and
// holds `rounded-[3px]` and friends to the same rule, since an arbitrary value
// is a fourth radius by another name.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === "generated" ? [] : files(join(dir, e.name));
    return e.name.endsWith(".tsx") ? [join(dir, e.name)] : [];
  });
}

// Comments talk about corners in English ("a rounded box"), so they go first.
// Block comments include JSX's `{/* … */}`.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ALLOWED = /^rounded(-(t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?-(mark|control|panel|full|none)$/;
const CLASS = /(?<![\w-])rounded(?:-[\w[\].]+)*(?![\w-])/g;

describe("corner radii", () => {
  const offenders = files(SRC).flatMap((path) =>
    [...stripComments(readFileSync(path, "utf8")).matchAll(CLASS)]
      .map((m) => m[0])
      .filter((cls) => !ALLOWED.test(cls))
      .map((cls) => `${path.slice(SRC.length + 1)}: ${cls}`),
  );

  it("uses only rounded-mark, rounded-control, rounded-panel or rounded-full", () => {
    expect(offenders).toEqual([]);
  });
});
