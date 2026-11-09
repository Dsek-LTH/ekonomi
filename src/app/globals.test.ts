import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const css = readFileSync(join(SRC, "app/globals.css"), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

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
  const LIGHT_ONLY = /^--(font|spacing|radius|ease|receipt|chart-[1-5]|chart-8)/;

  it("has a dark counterpart for every colour it names", () => {
    const missing = Object.keys(theme).filter((k) => !LIGHT_ONLY.test(k) && !(k in stated));
    expect(missing).toEqual([]);
  });

  it("names every token the dark block redefines", () => {
    const extra = Object.keys(stated).filter((k) => k !== "color-scheme" && !(k in theme));
    expect(extra).toEqual([]);
  });
});

describe("the print palette", () => {
  const inks = (d: Record<string, string>) =>
    Object.keys(d).filter((k) => k.startsWith("--color-") || k.startsWith("--chart-"));

  it("restores every colour the dark palette changes", () => {
    const missing = inks(stated).filter((k) => !(k in paper));
    expect(missing).toEqual([]);
  });
});

describe("no token is declared and then never used", () => {
  const sources = files(SRC)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it("every colour token is spent somewhere", () => {
    const unused = Object.keys(theme)
      .filter((k) => k.startsWith("--color-"))
      .filter((name) => {
        const bare = name.slice("--color-".length);
        const utility = new RegExp(
          `(?:bg|text|border|ring|divide|fill|stroke|outline|shadow|from|via|to` +
            `|caret|accent|decoration|placeholder)-${bare}(?![a-z0-9-])`,
        );
        return !new RegExp(`var\\(${name}\\b`).test(css + sources) && !utility.test(sources);
      });
    expect(unused).toEqual([]);
  });
});
