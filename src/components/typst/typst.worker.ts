// Typst in the browser: compiles a template with the data it is handed and draws it as SVG. Off the main thread so
// typing never waits on it. The compiler is kept between requests, which makes every compile after the first an
// incremental one (a few milliseconds), the same way typst.app updates as you type.
import { createTypstCompiler, createTypstRenderer, loadFonts } from "@myriaddreamin/typst.ts";
import { disableDefaultFontAssets } from "@myriaddreamin/typst.ts/dist/esm/options.init.mjs";
import type { TypstRequest, TypstResponse } from "./protocol";

const MAIN = "/main.typ";

const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

let engine: Promise<{
  compiler: ReturnType<typeof createTypstCompiler>;
  renderer: ReturnType<typeof createTypstRenderer>;
}> | null = null;
/** The template whose files are mapped in, by its URL. One at a time: a page shows one live document. */
let loaded: string | null = null;

async function start(env: TypstRequest["env"]) {
  const compiler = createTypstCompiler();
  const renderer = createTypstRenderer();
  const fonts = await Promise.all(env.fonts.map(bytes));
  await Promise.all([
    compiler.init({
      getModule: () => fetch(env.compilerWasm),
      // Only the faces we ship: the default set is fetched from a CDN, and a page here should not reach out.
      beforeBuild: [disableDefaultFontAssets(), loadFonts(fonts)],
    }),
    renderer.init({ getModule: () => fetch(env.rendererWasm) }),
  ]);
  return { compiler, renderer };
}

async function compile(req: TypstRequest): Promise<string> {
  engine ??= start(req.env);
  const { compiler, renderer } = await engine;
  if (loaded !== req.template.main) {
    const [source, ...files] = await Promise.all([
      fetch(req.template.main).then((r) => r.text()),
      ...Object.values(req.template.files).map(bytes),
    ]);
    compiler.resetShadow();
    compiler.addSource(MAIN, source);
    Object.keys(req.template.files).forEach((path, i) => compiler.mapShadow(path, files[i]));
    loaded = req.template.main;
  }
  const { result, diagnostics } = await compiler.compile({
    mainFilePath: MAIN,
    inputs: { data: JSON.stringify(req.data) },
    diagnostics: "unix",
  });
  if (!result) throw new Error(diagnostics?.join("\n") || "the compiler returned no document");
  // No script: the SVG is put into the page as markup.
  return renderer.renderSvg({
    format: "vector",
    artifactContent: result,
    data_selection: { body: true, defs: true, css: true, js: false },
  });
}

self.onmessage = async (e: MessageEvent<TypstRequest>) => {
  let reply: TypstResponse;
  try {
    reply = { id: e.data.id, svg: await compile(e.data) };
  } catch (err) {
    reply = { id: e.data.id, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
