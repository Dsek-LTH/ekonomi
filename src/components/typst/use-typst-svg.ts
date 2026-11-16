"use client";

import { useEffect, useState } from "react";
import type { TypstRequest, TypstResponse, TypstTemplate } from "./protocol";

// Resolved through the bundler, so each is served as a file of its own and always matches what is installed. Built on
// first use rather than at import: the module is also evaluated on the server, where none of this is wanted.
const env = (): TypstRequest["env"] => ({
  compilerWasm: new URL(
    "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm",
    import.meta.url,
  ).href,
  rendererWasm: new URL(
    "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm",
    import.meta.url,
  ).href,
  // The faces lib/server/typst.ts gives the server, so both draw the same page.
  fonts: [
    new URL("../../lib/expense/cover/fonts/Inter-Regular.ttf", import.meta.url).href,
    new URL("../../lib/expense/cover/fonts/Inter-Medium.ttf", import.meta.url).href,
    new URL("../../lib/expense/cover/fonts/Inter-SemiBold.ttf", import.meta.url).href,
    new URL("../../lib/expense/cover/fonts/Inter-Bold.ttf", import.meta.url).href,
  ],
});

/** The templates a page can draw live, each the same file the server typesets. */
const TEMPLATES = {
  invoiceCover: (): TypstTemplate => ({
    main: new URL("../../lib/server/invoice-cover/invoice-cover.typ", import.meta.url).href,
    files: {
      "/public/symbol_rosa.svg": new URL("../../../public/symbol_rosa.svg", import.meta.url).href,
    },
  }),
};

export type TypstTemplateName = keyof typeof TEMPLATES;

// One worker for the tab, started on first use and kept: the compiler's warm cache is the point.
let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (r: TypstResponse) => void>();

function draw(name: TypstTemplateName, data: unknown): Promise<TypstResponse> {
  if (!worker) {
    worker = new Worker(new URL("./typst.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<TypstResponse>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    // A worker that cannot start (no WebAssembly, a blocked fetch) answers nothing: settle what is waiting.
    worker.onerror = (e) => {
      for (const [id, resolve] of waiting) resolve({ id, error: e.message || "the worker failed" });
      waiting.clear();
    };
  }
  const id = ++nextId;
  const request: TypstRequest = { id, env: env(), template: TEMPLATES[name](), data };
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage(request);
  });
}

/**
 * A template drawn in the browser from `data`, redrawn on every change. Null until the first drawing is ready, and
 * for good if Typst cannot run here: the caller shows the server's PDF meanwhile. Null data draws nothing.
 */
export function useTypstSvg(name: TypstTemplateName, data: unknown): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  const key = JSON.stringify(data);
  useEffect(() => {
    if (key === "null") return;
    let current = true;
    void draw(name, JSON.parse(key)).then((r) => {
      if (!current) return;
      if ("svg" in r) setSvg(r.svg);
      else console.error(`[typst] the ${name} preview could not be drawn`, r.error);
    });
    return () => {
      current = false;
    };
  }, [name, key]);
  return svg;
}
