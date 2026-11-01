// The attest page in front of a levfaktura in Fortnox.
//
// Drawn as the utläggsräkning is (lib/expense/cover/expense-cover.typ), on
// purpose: the two are filed side by side in the same Fortnox, and a
// bookkeeper reading one should already know where everything is on the
// other. Same scale, same inks, same header, the same attest table. What
// differs is only what a supplier invoice has to say: whose invoice, its
// number and dates, and who sent it to Fortnox.
//
// Everything it says arrives through `sys.inputs`, pre-formatted in Swedish by
// lib/server/invoice-cover.ts.

#let data = json(bytes(sys.inputs.at("data")))

// ── The scale, as on the utläggsräkning ───────────────────────────────
#let body-size = 11pt
#let label-size = 9pt
#let heading-size = 14pt
#let table-size = 10pt

#let muted = luma(92)
#let ink = luma(58)

#let rule-strong = 0.8pt + luma(45)
#let rule-hair = 0.5pt + luma(170)

#set text(
  font: ("Inter", "Inter Display", "SF Pro Text", "Segoe UI", "Libertinus Serif"),
  size: body-size,
  lang: "sv",
)

#let figures(body) = text(number-width: "tabular", body)

#set page(
  paper: "a4",
  margin: (x: 0.6in, y: 0.8in),
  footer: context {
    if counter(page).final().first() > 1 {
      set text(size: label-size, fill: muted)
      align(center)[#counter(page).display("1 / 1", both: true)]
    }
  },
)

#let field(label, value) = block(below: 15pt, breakable: false)[
  #text(size: label-size, tracking: 0.6pt, weight: "bold")[#upper(label)] \
  #text(fill: ink)[#value]
]

#let orDash(v) = if v == none or v == "" { text(fill: muted)[-] } else { v }

#let th(label) = text(size: label-size, fill: ink, tracking: 0.6pt, weight: "bold")[
  #upper(label)
]

// ── Header ────────────────────────────────────────────────────────────
//
// The supplier where the utläggsräkning names how it was paid: the line under
// the title that says which kind of this document it is. Left out on the page
// shown in the panel before the treasury has picked one.
#grid(
  columns: (auto, 1fr, auto),
  column-gutter: 14pt,
  align: (left + top, left + top, right + top),
  image("/public/symbol_rosa.svg", width: 0.6in),
  stack(
    spacing: 8pt,
    text(size: label-size, tracking: 1pt, weight: "bold", fill: muted)[
      #upper("D-sektionen inom TLTH")
    ],
    text(size: 26pt, weight: "bold", tracking: -0.5pt)[Leverantörsfaktura],
    ..if data.supplier != none { (text(size: 18pt, fill: ink)[#data.supplier],) },
  ),
  field("Skapad", data.created),
)

#v(14pt)
#line(length: 100%, stroke: rule-strong)
#v(16pt)

// ── The invoice ───────────────────────────────────────────────────────
// One grid for both rows, so the description lines up under the invoice
// number rather than a gutter's width beside it.
#grid(
  columns: (1fr, 1fr, 1fr, 1fr),
  column-gutter: 16pt,
  // A field's own space below does not reach across a grid's rows.
  row-gutter: 15pt,
  field("Faktura", data.reference),
  field("Fakturanummer", orDash(data.invoiceNumber)),
  field("Fakturadatum", orDash(data.invoiceDate)),
  field("Förfallodag", orDash(data.dueDate)),
  field("Resultatenhet", orDash(data.resultUnit)),
  grid.cell(colspan: 3, field("Beskrivning", orDash(data.description))),
)

// ── Attesteringar ─────────────────────────────────────────────────────
//
// One row per cost centre the invoice was split on, with who signed it and
// when. The columns are the utläggsräkning's.
#v(8pt)
#text(size: heading-size, weight: "bold")[Attesteringar]
#v(9pt)

#block[
#set text(size: table-size, fill: ink)
#table(
  columns: (1.35fr, 1.5fr, auto, 1.15fr, auto),
  align: (left + top, left + top, right + top, left + top, right + top),
  stroke: none,
  inset: (x: 0pt, y: 7pt),
  column-gutter: 12pt,
  table.hline(stroke: rule-strong),
  table.header(
    th("Kostnadsställe"),
    th("Kommentar"),
    th("Belopp"),
    th("Attesterad av"),
    th("Attesterat"),
  ),
  table.hline(stroke: rule-hair),
  ..data.allocations
    .map(a => (
      text(weight: "medium")[#a.costCenter],
      text(fill: muted)[#a.comment],
      figures(text(weight: "medium")[#a.amount]),
      orDash(a.approvedBy),
      figures(text(fill: muted)[#orDash(a.approvedAt)]),
    ))
    .flatten(),
  table.hline(stroke: rule-hair),
)
]

#v(12pt)
#align(right)[
  #text(size: label-size, fill: muted, tracking: 0.6pt, weight: "semibold")[#upper("Summa")]
  #h(10pt)
  #figures(text(size: 16pt, weight: "bold")[#data.total])
]

// ── Kontering ─────────────────────────────────────────────────────────
//
// Who konterade it and who sent it. Fortnox names the supplier invoice after
// whoever sent it, so this page is where the kontering's author is on record.
#v(16pt)
#grid(
  columns: (1fr, 1fr, 2fr),
  column-gutter: 16pt,
  field("Konterad av", orDash(data.booking.by)),
  field("Konterat", orDash(data.booking.at)),
  field("Skickad till Fortnox av", orDash(data.exportedBy)),
)

// ── Underlag ──────────────────────────────────────────────────────────
#v(20pt)
#text(size: 9.5pt, fill: muted)[Fakturan följer på nästa sida.]
