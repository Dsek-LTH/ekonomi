// The dark palette is written twice, and this is what keeps the two the same.
//
// `.dark` is the preference the reader stated; `:root:not(.light)` inside a
// `prefers-color-scheme` query is the OS answering for a reader who never did.
// CSS has no way to put a media query inside a selector list, so there is no
// one place the values can live, and a token added to one copy and forgotten in
// the other is a colour that silently stops following the theme in exactly one
// of the two ways a document can be dark. That is the bug this file exists to
// turn into a red test.
//
// It also holds the light palette and the dark one to each other, which is the
// same failure a step earlier: a token declared in @theme and nowhere else
// keeps its light value on a dark ground.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const css = readFileSync(join(SRC, "app/globals.css"), "utf8");

/** Every hand-written source file under a directory, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/**
 * The custom properties a block declares, as name to value.
 *
 * Brace counting rather than a regex over the whole file: the palette blocks
 * contain no nested braces, but the file around them is full of them, and a
 * lazy match would run off the end of the first one into the next.
 */
function declarations(startsWith: string): Record<string, string> {
  const at = css.indexOf(startsWith);
  expect(at, `no block starting "${startsWith}"`).toBeGreaterThan(-1);
  let depth = 0;
  let end = at;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = css.slice(at, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].replace(/\s+/g, " ").trim();
  }
  return out;
}

const theme = declarations("@theme {");
const stated = declarations(".dark {");
const fromOs = declarations(":root:not(.light) {");
const paper = declarations("  :root,\n  :root:not(.light) {");

describe("the dark palette's two copies", () => {
  it("declare the same properties", () => {
    expect(Object.keys(fromOs).sort()).toEqual(Object.keys(stated).sort());
  });

  it("declare the same values", () => {
    expect(fromOs).toEqual(stated);
  });

  it("is not empty, so a rename cannot make this file pass by matching nothing", () => {
    expect(Object.keys(stated).length).toBeGreaterThan(30);
  });
});

describe("the light palette", () => {
  // Six of the eight chart tokens are `var()` aliases of tones the dark block
  // already redefines, so they follow the theme without appearing in it. Same
  // for the type, spacing and motion tokens, which are one value in both.
  const LIGHT_ONLY = /^--(font|spacing|ease|receipt|chart-[1-5]|chart-8)/;

  it("has a dark counterpart for every colour it names", () => {
    const missing = Object.keys(theme).filter(
      (k) => !LIGHT_ONLY.test(k) && !(k in stated),
    );
    expect(missing).toEqual([]);
  });

  it("names every token the dark block redefines", () => {
    const extra = Object.keys(stated).filter(
      (k) => k !== "color-scheme" && !(k in theme),
    );
    expect(extra).toEqual([]);
  });
});

describe("the print palette", () => {
  // A printed page is the one artefact that leaves the app, and the palette it
  // is drawn in is a third copy of the same list. A colour the dark block
  // redefines and this one does not is a dark-tuned value landing in ink: a
  // danger chip printing as a near-black block, a gridline invisible on white.
  // That was true of every soft tint until this test existed.
  const inks = (d: Record<string, string>) =>
    Object.keys(d).filter((k) => k.startsWith("--color-") || k.startsWith("--chart-"));

  it("restores every colour the dark palette changes", () => {
    const missing = inks(stated).filter((k) => !(k in paper));
    expect(missing).toEqual([]);
  });
});

describe("no token is declared and then never used", () => {
  // Five were, when this was written: --color-brand-soft and the -hover step of
  // accent, purple, success and warning. Ten declarations, in both themes,
  // maintained for nothing, and the names most likely to be reached for by
  // somebody who then finds them wrong because nothing was rendering them.
  const sources = files(SRC)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it("every colour token is spent somewhere", () => {
    const unused = Object.keys(theme)
      .filter((k) => k.startsWith("--color-"))
      .filter((name) => {
        const bare = name.slice("--color-".length);
        // Either as the variable itself, in this stylesheet or in an inline
        // style, or as the tail of a Tailwind utility built from its name
        // (`bg-hover`, `text-faint`, `border-pay-card/30`). The boundary stops
        // `--color-brand` from being counted as used by `bg-brand-soft`.
        //
        // The utility arm reads the components only. Looking for it in the
        // stylesheet as well made the whole check vacuous: every token's own
        // declaration in the dark block is a literal `--color-<name>:`, which
        // is a match for `-<name>`, so nothing could ever come back unused.
        //
        // Anchored on the property the utility starts with, not on the name
        // alone: `--color-hover` matched `group-hover:` under a looser pattern,
        // and a check that finds a use for everything finds nothing.
        const utility = new RegExp(
          `(?:bg|text|border|ring|divide|fill|stroke|outline|shadow|from|via|to` +
            `|caret|accent|decoration|placeholder)-${bare}(?![a-z0-9-])`,
        );
        return !new RegExp(`var\\(${name}\\b`).test(css + sources) && !utility.test(sources);
      });
    expect(unused).toEqual([]);
  });
});
