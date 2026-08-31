// The typesetter, and the only file in the app that knows there is one.
//
// Lifted out of expense/cover/typst.ts, which is only one of the documents the
// app draws. Everything in here was already general (one compiler for the
// process, the vendored faces, data handed over through `sys.inputs`) and the
// only thing that was ever about the cover was which template to run. So that
// is the argument now, and every template shares a warm compiler rather than
// each paying for its own.
//
// Nothing above this sees Typst. A caller names a template and hands over
// plain data; what comes back is PDF bytes.
import "server-only";

import path from "node:path";

import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";

/**
 * The workspace a template may read from.
 *
 * The app directory, because the templates draw the section's mark out of
 * `public/`, the one place that file lives, and a copy beside each template
 * would be two more things to keep in step. Present in the standalone image;
 * see the Dockerfile.
 */
const WORKSPACE = process.cwd();

/**
 * Inter, vendored under the cover template's directory.
 *
 * Not a preference, a requirement. Typst embeds exactly four faces, and the
 * only proportional ones among them are serifs (Libertinus Serif and New
 * Computer Modern; the third is DejaVu Sans *Mono*). So a document set in a
 * sans either ships the file or silently comes out in a serif on any machine
 * that does not happen to have one, which is every container we run.
 *
 * Four static weights rather than the variable font, because Typst instantiates
 * a variable font at its default axis and would render every weight the same.
 * ~1.6MB in the repo, and the reason a document looks identical on a laptop and
 * in the image.
 *
 * Still under expense/cover/ rather than moved beside this file: it is 1.6MB of
 * binaries with a git history, and where the bytes sit on disk matters less
 * than there being one copy of them. Every template gets the same faces.
 */
const FONT_DIR = path.join(WORKSPACE, "src/lib/expense/cover/fonts");

export class TypstError extends Error {}

/**
 * One compiler for the process, built on first use.
 *
 * Creating it costs about half a second (it is reading font collections) and
 * a render against a warm one costs under a millisecond. Per call that would be
 * half a second every time, which is the difference between a panel that opens
 * and one that hesitates.
 *
 * Lazy rather than at module load: importing this file should not cost anything
 * on a page that never typesets anything, and in dev that is most of them.
 */
let compiler: NodeCompiler | null = null;
const compilerFor = () =>
  (compiler ??= NodeCompiler.create({
    workspace: WORKSPACE,
    // The vendored faces are *added* to whatever the machine has, so a
    // developer's system fonts are still found. The templates name Inter
    // first, and this is what guarantees that name resolves everywhere.
    fontArgs: [{ fontPaths: [FONT_DIR] }],
  }));

/**
 * Render a template to PDF bytes, with `data` as its only input.
 *
 * The data goes in through `sys.inputs` rather than a file the template reads,
 * so a render writes nothing to disk and two of them cannot collide over a
 * scratch directory. It also keeps the compiler's cache bounded: keyed on the
 * template's path, which never changes, rather than on a fresh temp path per
 * request that would accumulate for the life of the process.
 *
 * `pdf()` is synchronous and blocks for the sub-millisecond it takes, which is
 * also what makes concurrent renders a non-question. Async anyway, because
 * every caller's own signature is, and an implementation that shelled out or
 * called a sidecar would need it.
 *
 * @param template Absolute path to the `.typ` file.
 * @param what     Names this document in the log line when Typst refuses it.
 */
export async function typeset(
  template: string,
  data: unknown,
  what: string,
): Promise<Uint8Array> {
  try {
    const pdf = compilerFor().pdf({
      mainFilePath: template,
      inputs: { data: JSON.stringify(data) },
    });
    if (!pdf) throw new Error("the compiler returned no document");
    return new Uint8Array(pdf);
  } catch (e) {
    // Typst's diagnostics name lines of a template, which is useful to us and
    // meaningless to a bookkeeper. The detail goes to the server log; the
    // caller gets a sentence.
    console.error(`[typst] ${what} failed`, e);
    throw new TypstError(`${what} could not be typeset`);
  }
}
