// An email ready to send: HTML from components.tsx, plain text from text.ts. render() is React Email's, not
// react-dom's: Next stubs the legacy react-dom/server APIs with throws (next/dist/build/webpack/alias/react-dom-server.js),
// so it goes through the streaming API and is async.
import { render } from "react-email";
import { EmailDocument } from "./components";
import type { Email } from "./types";

export { renderText } from "./text";
export { LOGO_CID } from "./types";
export type { Block, Email, Link, TagTone, Tone } from "./types";

export function renderHtml(email: Email): Promise<string> {
  return render(<EmailDocument email={email} />);
}
