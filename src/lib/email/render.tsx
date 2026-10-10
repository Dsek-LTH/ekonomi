// An email, ready to send: the HTML React Email draws from components.tsx, and
// the plain text from text.ts. The one entry point the rest of the app uses.
//
// render() is React Email's, not react-dom's renderToStaticMarkup, and that is
// not a matter of taste. Inside Next the legacy react-dom/server APIs are
// replaced by stubs that throw (next/dist/build/webpack/alias/react-dom-server.js),
// and every mail is drawn inside Next, by a route or a cron job. React Email's
// render goes through the streaming API, which is why it is async.
import { render } from "react-email";
import { EmailDocument } from "./components";
import type { Email } from "./types";

export { renderText } from "./text";
export { LOGO_CID } from "./types";
export type { Block, Email, Link, TagTone, Tone } from "./types";

export function renderHtml(email: Email): Promise<string> {
  return render(<EmailDocument email={email} />);
}
