// The typesetter, and the only file that knows there is one. A caller names a template and hands over plain
// data; what comes back is PDF bytes.
import "server-only";

import path from "node:path";

import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";

/** The workspace a template may read from: the app directory, since templates draw the mark from `public/`. */
const WORKSPACE = process.cwd();

/**
 * Inter, vendored under the cover template's directory. Required: Typst embeds only serif proportional
 * faces, so a sans document would silently fall back to a serif. Four static weights, because Typst
 * renders a variable font at its default axis.
 */
const FONT_DIR = path.join(WORKSPACE, "src/lib/expense/cover/fonts");

/**
 * The faces the section's documents are set in (Domitian for text, TeX Gyre Heros for headings, as the
 * guild's LaTeX classes name them), vendored so a document looks the same on every machine.
 */
const DSEK_FONT_DIR = path.join(WORKSPACE, "src/lib/server/fonts");

export class TypstError extends Error {}

/** One compiler for the process, built on first use (creating it takes about half a second). */
let compiler: NodeCompiler | null = null;
const compilerFor = () =>
  (compiler ??= NodeCompiler.create({
    workspace: WORKSPACE,
    // Vendored faces are added to the machine's, so the templates' Inter always resolves.
    fontArgs: [{ fontPaths: [FONT_DIR, DSEK_FONT_DIR] }],
  }));

/**
 * Render a template to PDF bytes, with `data` as its only input via `sys.inputs` (writes nothing to disk,
 * keeps the compiler's cache keyed on the template path).
 *
 * @param template Absolute path to the `.typ` file.
 * @param what     Names this document in the log line when Typst refuses it.
 */
export async function typeset(template: string, data: unknown, what: string): Promise<Uint8Array> {
  try {
    const pdf = compilerFor().pdf({
      mainFilePath: template,
      inputs: { data: JSON.stringify(data) },
    });
    if (!pdf) throw new Error("the compiler returned no document");
    return new Uint8Array(pdf);
  } catch (e) {
    // Typst diagnostics go to the server log; the caller gets a sentence.
    console.error(`[typst] ${what} failed`, e);
    throw new TypstError(`${what} could not be typeset`);
  }
}
