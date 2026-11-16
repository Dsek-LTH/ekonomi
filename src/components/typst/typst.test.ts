import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTypstCompiler, createTypstRenderer, loadFonts } from "@myriaddreamin/typst.ts";
import { disableDefaultFontAssets } from "@myriaddreamin/typst.ts/dist/esm/options.init.mjs";
import { buildInvoiceCoverData, liveCoverFacts, type CoverFacts } from "@/lib/ui/invoice-cover";

const root = process.cwd();
const read = (path: string) => new Uint8Array(readFileSync(join(root, path)));

// The server typesets with the Node compiler, the browser previews with the WebAssembly one. Different versions could
// draw the same template differently, and the preview would stop being what is sent.
describe("the Typst packages", () => {
  const PACKAGES = [
    "@myriaddreamin/typst-ts-node-compiler",
    "@myriaddreamin/typst-ts-web-compiler",
    "@myriaddreamin/typst-ts-renderer",
    "@myriaddreamin/typst.ts",
  ];

  it("are pinned to one exact version", () => {
    const deps = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies;
    const specs = PACKAGES.map((p) => deps[p]);
    expect(specs[0]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(new Set(specs)).toEqual(new Set([specs[0]]));
  });

  it("are installed at that version", () => {
    const installed = PACKAGES.map(
      (p) =>
        JSON.parse(readFileSync(join(root, "node_modules", p, "package.json"), "utf8")).version,
    );
    expect(new Set(installed)).toEqual(new Set([installed[0]]));
  });
});

const facts: CoverFacts = {
  reference: "LEV26-0012",
  supplierName: "Lunds Släpvagnsuthyrning AB",
  invoiceNumber: "20417",
  invoiceDate: "2026-10-20",
  dueDate: "2026-11-10",
  amount: 125000,
  description: "Släp till nollningen",
  resultUnit: "Sexmästeriet",
  rows: [
    {
      costCenter: "SEX01",
      amount: 125000,
      attestedBy: "Klara Ström",
      attestedAt: new Date("2026-10-27T10:00:00Z"),
      comment: null,
    },
  ],
  booking: null,
  exportedBy: null,
  created: new Date("2026-11-01T12:00:00Z"),
};

describe("liveCoverFacts", () => {
  const edits = {
    supplierName: "Annan AB",
    invoiceNumber: "999",
    invoiceDate: "2026-10-21",
    dueDate: "2026-11-11",
    amount: 200000,
  };

  it("lays the typed values over the saved page, the single row following the total", () => {
    const live = liveCoverFacts(facts, edits);
    expect(live).toMatchObject(edits);
    expect(live.rows[0].amount).toBe(200000);
    expect(live.rows[0].attestedBy).toBe("Klara Ström");
  });

  it("leaves a split's shares as attested", () => {
    const split = { ...facts, rows: [facts.rows[0], { ...facts.rows[0], costCenter: "SEX02" }] };
    expect(liveCoverFacts(split, edits).rows.map((r) => r.amount)).toEqual([125000, 125000]);
  });
});

// What components/typst/typst.worker.ts does in the browser, run here: the same template, fonts and data.
describe("the browser preview", () => {
  it("draws the attest page from the server's template", async () => {
    const compiler = createTypstCompiler();
    const renderer = createTypstRenderer();
    const fonts = ["Regular", "Medium", "SemiBold", "Bold"].map((w) =>
      read(`src/lib/expense/cover/fonts/Inter-${w}.ttf`),
    );
    await compiler.init({
      getModule: () =>
        read("node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm"),
      beforeBuild: [disableDefaultFontAssets(), loadFonts(fonts)],
    });
    await renderer.init({
      getModule: () =>
        read("node_modules/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm"),
    });
    compiler.addSource(
      "/main.typ",
      readFileSync(join(root, "src/lib/server/invoice-cover/invoice-cover.typ"), "utf8"),
    );
    compiler.mapShadow("/public/symbol_rosa.svg", read("public/symbol_rosa.svg"));

    const draw = async (f: CoverFacts) => {
      const { result } = await compiler.compile({
        mainFilePath: "/main.typ",
        inputs: { data: JSON.stringify(buildInvoiceCoverData(f)) },
      });
      expect(result).toBeDefined();
      return renderer.renderSvg({ format: "vector", artifactContent: result! });
    };

    const svg = await draw(facts);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Lunds Släpvagnsuthyrning AB");
    expect(await draw({ ...facts, supplierName: "Annan AB" })).toContain("Annan AB");
  });
});
