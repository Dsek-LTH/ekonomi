// The plain-text drawing of an email, for clients that show no HTML and for
// the log in development. Written by hand rather than derived from the HTML:
// it says in words what the HTML says with colour ("(Återbetalning)" where the
// HTML has a green amount), and spells out every link.
import type { Block, Email } from "./types";

function blockText(b: Block): string[] {
  switch (b.kind) {
    case "expense":
      return [
        b.reference ? `${b.reference} – ${b.title}` : b.title,
        b.amount,
        ...b.facts.map((f) => `${f.label}: ${f.value}`),
      ];
    case "comment":
      return [`${b.author}, ${b.when}:`, ...b.text.split("\n").map((l) => `> ${l}`)];
    case "transactions":
      return [
        ...b.rows.map(
          (r) => `${r.date} – ${r.description} – ${r.amount}${r.refund ? ` (${b.refundLabel})` : ""}`,
        ),
        ...(b.more ? [b.more] : []),
      ];
    case "stats":
      return [b.items.map((s) => `${s.value} ${s.label}`).join(", ")];
    case "list":
      return [
        ...b.rows.map((r) =>
          [r.title, r.sub, r.amount ?? r.pill].filter(Boolean).join(", "),
        ),
        ...(b.more ? [b.more] : []),
      ];
    case "section":
      return [
        b.title.toUpperCase(),
        ...(b.hint ? [b.hint] : []),
        ...b.blocks.flatMap((inner) => ["", ...blockText(inner)]),
        ...(b.link ? ["", `${b.link.label}: ${b.link.url}`] : []),
        ...(b.button ? ["", `${b.button.label}: ${b.button.url}`] : []),
      ];
  }
}

export function renderText(e: Email): string {
  return [
    e.heading,
    ...(e.intro ? [e.intro] : []),
    ...e.blocks.flatMap((b) => ["", ...blockText(b)]),
    ...(e.action ? ["", `${e.action.label}: ${e.action.url}`] : []),
    "",
    "-- ",
    e.footer.reason,
    `${e.footer.settings.label} ${e.footer.settings.url}`,
    e.footer.org,
  ].join("\n");
}
