// The Typst implementation of `CoverRenderer`.
//
// The only file in the app that knows what typesets the cover. Everything above
// it sees `renderCover(data) => Promise<Uint8Array>` and nothing else, so
// replacing this with a LaTeX or a sidecar implementation is a matter of
// writing the same signature — see cover/types.ts.
//
// Typst as a *library*, not as a binary. This ran the `typst` CLI first, and
// that was wrong for one blunt reason: it made a system dependency out of
// something the app should install for itself. `pnpm dev` on a machine without
// it got a 502 where the receipt used to be, and "brew install typst" is not an
// answer — a checkout should run from `pnpm install` and nothing else.
//
// The napi build publishes musl artifacts for both architectures alongside the
// darwin ones, so the same dependency covers a laptop and the alpine image;
// there is no typesetter in the Dockerfile because there is no longer anything
// to put there.
//
// The receipt is deliberately NOT embedded here. Typst can include PDF pages,
// but doing so imposes its constraints on the input: an embedded PDF's version
// may not exceed the export target's, encrypted files are refused outright, and
// nothing in the language reports how many pages a document has (typst#6644).
// Receipts come from whatever a supplier's till prints. So the cover is a fixed
// page built only from our own data, and pdf-lib — which is built for input
// nobody chose — staples the underlag on afterwards.
import "server-only";

import path from "node:path";

import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";

import type { CoverRenderer, ExpenseCoverData } from "./types";

/**
 * The template, and the root it may read from.
 *
 * The workspace is the app directory because the template also draws the
 * section's mark out of `public/`, which is the one place that file lives — a
 * second copy beside the template would be a second thing to keep in step.
 * Both are present in the standalone image; see the Dockerfile.
 */
const WORKSPACE = process.cwd();
const COVER_DIR = path.join(WORKSPACE, "src/lib/expense/cover");
const TEMPLATE = path.join(COVER_DIR, "expense-cover.typ");

/**
 * Inter, vendored beside the template.
 *
 * Not a preference — a requirement. Typst embeds exactly four faces, and the
 * only proportional ones among them are serifs (Libertinus Serif and New
 * Computer Modern; the third is DejaVu Sans *Mono*). So a document set in a
 * sans either ships the file or silently comes out in a serif on any machine
 * that does not happen to have one — which is every container we run.
 *
 * Four static weights rather than the variable font, because Typst instantiates
 * a variable font at its default axis and would render every weight the same.
 * ~1.6MB in the repo, and the reason the document looks identical on a laptop
 * and in the image.
 */
const FONT_DIR = path.join(COVER_DIR, "fonts");

export class CoverRenderError extends Error {}

/**
 * One compiler for the process, built on first use.
 *
 * Creating it costs about half a second — it is reading font collections — and
 * a render against a warm one costs under a millisecond. Per call that would be
 * half a second every time, which is the difference between a panel that opens
 * and one that hesitates.
 *
 * Lazy rather than at module load: importing this file should not cost anything
 * on a page that never renders a cover, and in dev that is most of them.
 */
let compiler: NodeCompiler | null = null;
const compilerFor = () =>
  (compiler ??= NodeCompiler.create({
    workspace: WORKSPACE,
    // The vendored faces are *added* to whatever the machine has, so a
    // developer's system fonts are still found — the template names Inter
    // first, and this is what guarantees that name resolves everywhere.
    fontArgs: [{ fontPaths: [FONT_DIR] }],
  }));

/**
 * Render the cover to PDF bytes.
 *
 * The data goes in through `sys.inputs` rather than a file the template reads,
 * so a render writes nothing to disk and two of them cannot collide over a
 * scratch directory. It also keeps the compiler's cache bounded: keyed on the
 * template's path, which never changes, rather than on a fresh temp path per
 * request that would accumulate for the life of the process.
 *
 * `pdf()` is synchronous and blocks for the sub-millisecond it takes, which is
 * also what makes concurrent renders a non-question. Async anyway, because the
 * signature belongs to `CoverRenderer` and an implementation that shelled out
 * or called a sidecar would need it.
 */
export const renderCover: CoverRenderer = async (data: ExpenseCoverData) => {
  try {
    const pdf = compilerFor().pdf({
      mainFilePath: TEMPLATE,
      inputs: { data: JSON.stringify(data) },
    });
    if (!pdf) throw new Error("the compiler returned no document");
    return new Uint8Array(pdf);
  } catch (e) {
    // Typst's diagnostics name lines of the template, which is useful to us and
    // meaningless to a bookkeeper. The detail goes to the server log; the
    // caller gets a sentence.
    console.error("[cover] typst failed", e);
    throw new CoverRenderError("the cover page could not be typeset");
  }
};
