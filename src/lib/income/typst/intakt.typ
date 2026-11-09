// The intäktsräkning: one source's takings for one day.
//
// Everything it says arrives through `sys.inputs`, built by
// lib/income/document-data.ts and handed over by lib/income/render.ts as one
// JSON string. It reads no file but this one, the section's mark and the faces
// lib/server/typst.ts loads, and writes nothing.
//
// It replaces the LaTeX page the intakt service drew. That page had one
// verksamhet and a scanned signature that was the same whoever approved the
// day. This one has a section per verksamhet, the voucher's rows with their
// cost centres, and the reviewer's name. The look follows the utläggsräkning
// (lib/expense/cover/expense-cover.typ), so the two documents read as one set.

#let data = json(bytes(sys.inputs.at("data")))

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

#let th(label) = text(size: label-size, fill: ink, tracking: 0.6pt, weight: "bold")[
  #upper(label)
]

// ── Header ────────────────────────────────────────────────────────────
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
    text(size: 26pt, weight: "bold", tracking: -0.5pt)[Intäktsräkning],
    text(size: 18pt, fill: ink)[#data.paymentType],
  ),
  field("Skapad", data.created),
)

#v(14pt)
#line(length: 100%, stroke: rule-strong)
#v(16pt)

#grid(
  columns: (1fr, 1fr, 1fr, 1fr),
  column-gutter: 16pt,
  field("Datum", data.date),
  field("Betalsätt", data.paymentType),
  field("Försäljning", figures[#data.salesTotal kr]),
  field("Att redovisa", figures[#data.total kr]),
)

// ── Fördelning ────────────────────────────────────────────────────────
//
// The verifikation's rows in words, in the same order and with the same
// figures, so a reader can lay this page beside the voucher in Fortnox and
// tick them off. A fee is a negative amount here, as it is what it takes out.
#v(4pt)
#text(size: heading-size, weight: "bold")[Fördelning]
#v(9pt)

#block[
#set text(size: table-size, fill: ink)
#table(
  columns: (auto, 1.4fr, 1.4fr, auto),
  align: (left + top, left + top, left + top, right + top),
  stroke: none,
  inset: (x: 0pt, y: 6pt),
  column-gutter: 12pt,
  table.hline(stroke: rule-strong),
  table.header(th("Konto"), th("Benämning"), th("Kostnadsställe"), th("Belopp (kr)")),
  table.hline(stroke: rule-hair),
  ..data.distribution
    .map(d => (
      figures(text(weight: "medium")[#d.account]),
      d.name,
      d.costCenter,
      figures(text(weight: "medium")[#d.amount]),
    ))
    .flatten(),
  table.hline(stroke: rule-hair),
)
]

// ── One section per verksamhet, then the fees ─────────────────────────
//
// The same three levels as the review screen's sold-lines table: the
// verksamhet with its sum, each account under it with its sum, and the
// products rung up on that account, grouped the way the screen groups them
// (lib/income/product-groups.ts): a product with variants is said once, its
// variants stepped in beneath it. There is no account column, since every
// line under an account heading is on that account. A thin bar down the left
// edge ties an account's lines to its heading.
#let account-fill = luma(244)
#let bar = (left: 1.5pt + luma(200))

#let section(s) = {
  v(10pt)
  grid(
    columns: (1fr, auto),
    text(size: heading-size, weight: "bold")[#s.title],
    align(right + bottom, figures(text(weight: "bold")[#s.total kr])),
  )
  v(6pt)
  let cols = if data.discounts { (1fr, auto, auto, auto, auto) } else { (1fr, auto, auto, auto) }
  let heads = (th("Vara"), th("Antal"), th("Pris (kr)"))
  if data.discounts { heads.push(th("Rabatt (kr)")) }
  heads.push(th("Belopp (kr)"))
  let n = cols.len()
  block({
    set text(size: table-size, fill: ink)
    table(
      columns: cols,
      align: (col, _) => if col == 0 { left + horizon } else { right + horizon },
      stroke: none,
      inset: (x: 6pt, y: 4.5pt),
      table.hline(stroke: rule-strong),
      table.header(..heads),
      table.hline(stroke: rule-hair),
      ..s.accounts
        .map(a => {
          // The account heading: its number and name, and what it comes to.
          let heading = (
            // In code, not markup: a "- " at the start of a line of markup is
            // a list item, and the name came out on a line of its own with a
            // bullet in front of it.
            table.cell(
              colspan: n - 1,
              fill: account-fill,
              stroke: bar,
              figures(text(weight: "semibold", fill: luma(30), a.account))
                + if a.name != "" { text(fill: muted, " - " + a.name) },
            ),
            table.cell(fill: account-fill, figures(text(weight: "semibold", fill: luma(30))[#a.total])),
          )
          let rows = a.rows.map(r => {
            if r.kind == "group" {
              (table.cell(colspan: n, stroke: bar, inset: (left: 14pt, rest: 4.5pt), text(weight: "medium", fill: luma(30))[#r.name]),)
            } else {
              let pad = if r.indented { 26pt } else { 14pt }
              let label = if r.indented { [↳ ] + r.label } else { r.label }
              let cells = (
                table.cell(stroke: bar, inset: (left: pad, rest: 4.5pt), label),
                figures(r.quantity),
                figures(r.unitPrice),
              )
              if data.discounts { cells.push(figures(text(fill: muted)[#r.discount])) }
              cells.push(figures(text(weight: "medium")[#r.total]))
              cells
            }
          })
          (heading, ..rows).flatten()
        })
        .flatten(),
      table.hline(stroke: rule-hair),
    )
  })
}

#for s in data.sections { section(s) }
#if data.fees != none { section(data.fees) }

// ── Attestering ───────────────────────────────────────────────────────
//
// Who reviewed the day against this page and booked it. A name, not a
// signature: approving in the app is the attest, and an image of someone's
// handwriting printed beside whoever happened to book was a claim the page
// could not back up.
#v(18pt)
#grid(
  columns: (1fr, 1fr, 2fr),
  column-gutter: 16pt,
  field("Attesterad av", data.attestation.name),
  field("STIL-ID", data.attestation.studentId),
  field("Datum", data.created),
)
