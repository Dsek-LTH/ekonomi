// Closes settings when a link inside it leads out of it.
//
// A parallel slot keeps whatever it last rendered across a soft navigation to a
// URL it has no match for, and default.tsx only covers a hard load. So a link
// from a settings page to the rest of the app (a card's purchases on /bank, say)
// navigated underneath while the overlay stayed open on top, and its close
// button then went back from /bank rather than out of settings. Matching every
// other URL here, and rendering nothing for it, is what empties the slot.
export default function CatchAll() {
  return null;
}
