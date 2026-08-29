// The utläggsräkning cover page.
//
// Everything it says arrives through `sys.inputs`, handed over by
// cover/typst.ts as one JSON string — so a render reads no file but this one,
// the mark it draws and the faces in fonts/, and writes nothing at all.
//
// It used to be styled after intakt's intäktsräkning, down to the Palatino.
// That resemblance is dropped: the two are rendered by different programs, in
// different languages, for different documents, and holding them alike only
// meant this one inherited a serif and a five-column table that no longer fit
// what it has to say. This is a modern form — one sans, one scale, one row per
// attest and every field in a column of its own.

#let data = json(bytes(sys.inputs.at("data")))

// ── The scale ─────────────────────────────────────────────────────────
//
// One place to turn, because "make this easier to read" is a request that comes
// back, and hunting the same numbers through five call sites is how a document
// ends up with four slightly different greys in it.
#let body-size = 11pt
#let label-size = 9pt
#let heading-size = 14pt
#let table-size = 10pt

// Two inks, and which is which is the page's one typographic idea.
//
// The label is the bold one. On a document read by somebody checking a specific
// thing — who attested SEKT05, what the STIL-ID was — the labels are the index,
// and setting them bold is what lets an eye land on the right one without
// reading the values on the way past.
//
// The value is then free to sit back. Full black under a bold label reads as
// two things shouting; a step off it is still perfectly legible and lets the
// label do the finding.
#let muted = luma(92)
#let ink = luma(58)

// The rules. Structure, not suggestion.
#let rule-strong = 0.8pt + luma(45)
#let rule-hair = 0.5pt + luma(170)

// Inter, vendored in fonts/ and loaded by cover/typst.ts — Typst embeds no
// proportional sans of its own, so naming one without shipping it would come
// out a serif in the container. The rest of the stack is for a machine that has
// its own and nothing else; `libertinus serif` is Typst's own fallback and only
// there so a missing fonts/ directory produces a document rather than a crash.
#set text(
  font: ("Inter", "Inter Display", "SF Pro Text", "Segoe UI", "Libertinus Serif"),
  size: body-size,
  lang: "sv",
)

// Figures that line up, for the things read down a column. Deliberately not set
// on the whole document: tabular figures give every digit the width of the
// widest, which is right for a krona column and wrong for a date or a StiL-ID,
// where it reads as though the characters have been spaced apart.
#let figures(body) = text(number-width: "tabular", body)

#set page(
  paper: "a4",
  margin: (x: 0.6in, y: 0.8in),
  // Only from the second page: a one-page cover that says "1 / 1" is answering
  // a question nobody asked. A long attest list is where it starts earning.
  footer: context {
    if counter(page).final().first() > 1 {
      set text(size: label-size, fill: muted)
      align(center)[#counter(page).display("1 / 1", both: true)]
    }
  },
)

// A label over its value, which is the shape every fact outside the table takes.
// Uppercase and tracked, so it needs the weight back that capitalising costs.
#let field(label, value) = block(below: 15pt, breakable: false)[
  #text(size: label-size, tracking: 0.6pt, weight: "bold")[#upper(label)] \
  #text(fill: ink)[#value]
]

// An empty value is said, not left blank: a gap invites "did it not fit?", and
// on a document that substantiates a voucher that is the wrong question.
#let orDash(v) = if v == none or v == "" { text(fill: muted)[–] } else { v }

// One column heading — the same pairing as `field`, laid sideways.
#let th(label) = text(size: label-size, fill: ink, tracking: 0.6pt, weight: "bold")[
  #upper(label)
]

// ── Header ────────────────────────────────────────────────────────────
#grid(
  columns: (auto, 1fr, auto),
  column-gutter: 14pt,
  align: (left + top, left + top, right + top),
  // The one copy of the section's mark, read out of public/ rather than
  // duplicated beside this file where it would quietly fall out of step.
  image("/public/symbol_rosa.svg", width: 0.6in),
  // `stack`, not paragraphs with `v(weak: true)` between them: weak spacing
  // collapses against the block edges, which slid the payment type up
  // underneath the title. This spaces what it is given and nothing else.
  stack(
    spacing: 8pt,
    text(size: label-size, tracking: 1pt, weight: "bold", fill: muted)[
      #upper("D-sektionen inom TLTH")
    ],
    text(size: 26pt, weight: "bold", tracking: -0.5pt)[Utläggsräkning],
    text(size: 18pt, fill: ink)[#data.paymentType],
  ),
  field("Skapad", data.created),
)

#v(14pt)
#line(length: 100%, stroke: rule-strong)
#v(16pt)

// ── The utlägg, and who submitted it ──────────────────────────────────
//
// Four columns rather than two: every one of these is a short value, and set
// two-up they left half the page white while the description wrapped.
#grid(
  columns: (1fr, 1fr, 1fr, 1fr),
  column-gutter: 16pt,
  field("Utlägg", data.reference),
  field(data.dateLabel, orDash(data.purchaseDate)),
  field("Utlägget avser", data.submitter.name),
  field("STIL-ID", orDash(data.submitter.studentId)),
)

#field("Beskrivning", data.title)

// ── Resan ─────────────────────────────────────────────────────────────
//
// Only on a milersättning, and there it stands in for the receipt: the pages
// after this one are the underlag for every other kind of utlägg, and a mileage
// claim has none — there is nothing to photograph about driving your own car.
// So the evidence is set out here, on the page that is filed either way, rather
// than in a second document repeating this one's reference and submitter.
//
// The two readings and their difference, side by side and written to the same
// precision, so the subtraction is one a reader can do by eye. A claim that only
// stated the distance would be asking to be taken on trust, which is the one
// thing an underlag must never do.
#if data.journey != none [
  #v(8pt)
  #text(size: heading-size, weight: "bold")[Resan]
  #v(9pt)

  #block[
  #set text(size: table-size, fill: ink)
  #table(
    // Sized to their headings, not split evenly. "Mätarställning vid start" is
    // the widest thing in the table and an even split gave it about two thirds
    // of what it needs, so it wrapped and took the whole header row to two
    // lines with it. `auto` lets each column ask for what it holds; the slack
    // collects in the one 1fr column, which puts it between the pair of
    // readings and the figures worked out from them — the gap falls where the
    // meaning changes.
    columns: (auto, auto, 1fr, auto),
    align: (right + top, right + top, right + top, right + top),
    stroke: none,
    inset: (x: 0pt, y: 7pt),
    column-gutter: 12pt,
    table.hline(stroke: rule-strong),
    table.header(
      th("Mätarställning vid start"),
      th("Vid slut"),
      th("Sträcka"),
      th("Ersättning"),
    ),
    table.hline(stroke: rule-hair),
    figures(text(fill: muted)[#data.journey.odometerStart]),
    figures(text(fill: muted)[#data.journey.odometerEnd]),
    // The distance carries the weight: it is the one figure on the row that the
    // money is worked out from, and the two readings beside it are its
    // evidence. What it comes to is in the attest table below, where every
    // other krona on the page is.
    figures(text(weight: "medium")[#data.journey.distance]),
    figures(text(fill: muted)[#data.journey.rate]),
    table.hline(stroke: rule-hair),
  )
  ]
]

// ── Attesteringar ─────────────────────────────────────────────────────
//
// The reason this page exists. One row per cost-centre slice, each with the
// person who cleared it and when — which is what a bookkeeper opening the
// voucher in Fortnox is looking for and could not otherwise see.
#v(8pt)
#text(size: heading-size, weight: "bold")[Attesteringar]
#v(9pt)

// A step down from the body, which is what lets five columns of real text sit
// across A4 without any of them becoming a ribbon. Scoped to a block so the
// summa below it keeps the document's size.
#block[
#set text(size: table-size, fill: ink)
#table(
  // Five columns, one fact each, nothing stacked. Weighted by what actually
  // goes in them rather than evenly: a committee's full name and a submitter's
  // note are the long ones, an approver's name is usually two words, and the
  // amount and date take exactly what a number takes.
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
      // The cost centre and the amount keep a little more weight than the rest
      // of the row: they are what a reader scans down, and the columns beside
      // them are what they stop for.
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

// The one number somebody checks first, so it is the largest thing below the
// title rather than the same size as the heading above it.
#v(12pt)
#align(right)[
  #text(size: label-size, fill: muted, tracking: 0.6pt, weight: "semibold")[#upper("Summa")]
  #h(10pt)
  #figures(text(size: 16pt, weight: "bold")[#data.total])
]

// ── Underlag ──────────────────────────────────────────────────────────
//
// Said out loud, because the pages after this one are not part of this
// document in any way the reader can tell — they were stapled on afterwards
// (lib/server/pdf-merge.ts) and could as easily not have been.
//
// Not on a milersättning, which is the one utlägg whose underlag is above: the
// journey is on this page and no page follows it, so the sentence would be
// sending a reader after something that is not there.
#if data.journey == none [
  #v(20pt)
  #text(size: 9.5pt, fill: muted)[Underlaget för utlägget följer på nästa sida.]
]
