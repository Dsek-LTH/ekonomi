// Uthyrningsavtal: the document the section and a renter both put their name to.
//
// Everything it says arrives through `sys.inputs`, handed over by rental/typst.ts
// as one JSON string, so a render reads no file but this one, the mark it draws
// and the faces in fonts/, and writes nothing at all. The same contract the
// utläggsräkning has with its own template.
//
// It is set in the same hand as the utläggsräkning (Inter, one scale, bold
// labels over quiet values) because both are documents this section issues and
// a renter who has also seen a utläggsräkning should recognise where it came
// from. Where it differs is what a contract has to do that a cover page does
// not: it has to be read end to end by somebody deciding whether to sign it, so
// the terms are set as running prose at reading size rather than squeezed into
// the margin, and the signature blocks are given room rather than fitted into
// what was left.

#let data = json(bytes(sys.inputs.at("data")))

// ── The scale ─────────────────────────────────────────────────────────
//
// The utläggsräkning's, one step down in the body: this page is read rather
// than scanned, and 10pt over a full measure is a more comfortable read than
// 11pt is.
#let body-size = 10pt
#let label-size = 8.5pt
#let heading-size = 13pt
#let table-size = 9.5pt

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
  margin: (x: 0.7in, y: 0.8in),
  // On every page, unlike the cover's. A contract runs to two or three pages
  // and the parties keep a copy each: a page that has come loose has to be
  // placeable, and "2 / 3" is what places it.
  footer: context {
    set text(size: label-size, fill: muted)
    grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      [Uthyrningsavtal – #data.termsVersion],
      counter(page).display("1 / 1", both: true),
    )
  },
)

#let field(label, value) = block(below: 13pt, breakable: false)[
  #text(size: label-size, tracking: 0.6pt, weight: "bold")[#upper(label)] \
  #text(fill: ink)[#value]
]

#let orDash(v) = if v == none or v == "" { text(fill: muted)[–] } else { v }

#let th(label) = text(size: label-size, fill: ink, tracking: 0.6pt, weight: "bold")[
  #upper(label)
]

// ── Header ────────────────────────────────────────────────────────────
#grid(
  columns: (auto, 1fr, auto),
  column-gutter: 14pt,
  align: (left + top, left + top, right + top),
  image("/public/symbol_rosa.svg", width: 0.55in),
  stack(
    spacing: 7pt,
    text(size: label-size, tracking: 1pt, weight: "bold", fill: muted)[
      #upper(data.lessor.name)
    ],
    text(size: 24pt, weight: "bold", tracking: -0.5pt)[Uthyrningsavtal],
    text(size: 13pt, fill: ink)[#data.title],
  ),
  field("Upprättat", data.drawn),
)

#v(12pt)
#line(length: 100%, stroke: rule-strong)
#v(14pt)

// ── Parterna ──────────────────────────────────────────────────────────
//
// Side by side, because a contract's first question is who is bound by it and
// the answer is a pair. Uthyraren on the left, since that is the section, and a
// document is read from the side that issued it.
#let partyBlock(role, name, orgNo, contact) = [
  #text(size: label-size, tracking: 0.6pt, weight: "bold")[#upper(role)] \
  #text(fill: ink, weight: "medium")[#name] \
  #if orgNo != none and orgNo != "" [
    #text(size: table-size, fill: muted)[Org.nr #orgNo] \
  ]
  #if contact != none and contact != "" [
    #text(size: table-size, fill: muted)[#contact]
  ]
]

#grid(
  columns: (1fr, 1fr),
  column-gutter: 20pt,
  partyBlock(
    "Uthyrare",
    data.lessor.name,
    data.lessor.orgNo,
    none,
  ),
  partyBlock(
    "Hyrestagare",
    data.counterparty,
    data.counterpartyOrgNo,
    // The renter's own contact details, where a signatory was named. This is
    // the one place on the page they appear, and they are here rather than in
    // the signature block because a party is identified once.
    if data.counterpartyParty != none {
      (data.counterpartyParty.email, data.counterpartyParty.phone)
        .filter(v => v != none and v != "")
        .join(" – ")
    } else { none },
  ),
)

#v(16pt)

// ── Hyresperiod ───────────────────────────────────────────────────────
#grid(
  columns: (1fr, 1fr, 1fr),
  column-gutter: 16pt,
  field("Uthämtas", data.pickupAt),
  field("Återlämnas", data.returnAt),
  field("Plats", orDash(data.place)),
)

#if data.purpose != none and data.purpose != "" [
  #field("Ändamål", data.purpose)
]

// ── Utrustningen ──────────────────────────────────────────────────────
//
// The replacement value has a column of its own rather than a footnote. It is
// the figure the liability clause turns on, and a renter who signs without
// having seen what a speaker costs to replace has not really been told what
// they are agreeing to.
#v(4pt)
#text(size: heading-size, weight: "bold")[Utrustning]
#v(9pt)

#block[
#set text(size: table-size, fill: ink)
#table(
  columns: (1fr, auto, auto, auto, auto),
  align: (left + top, right + top, right + top, right + top, right + top),
  stroke: none,
  inset: (x: 0pt, y: 6pt),
  column-gutter: 14pt,
  table.hline(stroke: rule-strong),
  table.header(
    th("Utrustning"),
    th("Antal"),
    th("Pris/st"),
    th("Summa"),
    th("Återanskaffning"),
  ),
  table.hline(stroke: rule-hair),
  ..data.lines
    .map(l => (
      text(fill: black)[#l.description],
      figures(text(fill: muted)[#l.quantity]),
      figures(text(fill: muted)[#l.unitPrice]),
      figures(text(weight: "medium")[#l.lineTotal]),
      figures(text(fill: muted)[#l.replacementValue]),
    ))
    .flatten(),
  table.hline(stroke: rule-hair),
  // The totals row. Only two of the five columns carry one: the rent is what
  // is owed and the replacement total is what is at stake, and a sum under
  // "Antal" would be a number nobody has a use for.
  th("Totalt"),
  [], [],
  figures(text(weight: "bold")[#data.price]),
  figures(text(weight: "medium")[#data.totalReplacement]),
  table.hline(stroke: rule-strong),
)
]

#v(10pt)

#grid(
  columns: (1fr, 1fr),
  column-gutter: 20pt,
  field("Hyra", data.price),
  field("Deposition", data.deposit),
)

// ── Villkor ───────────────────────────────────────────────────────────
//
// Numbered, because the clauses are what a dispute points at and "punkt 5" has
// to mean something. The numbering is drawn from the order of the sections
// rather than written into the text, so inserting one renumbers the rest.
#v(6pt)
#text(size: heading-size, weight: "bold")[Villkor]
#v(9pt)

#for (i, section) in data.terms.enumerate() [
  #block(below: 10pt, breakable: false)[
    #text(weight: "bold")[#(i + 1). #section.heading]
  ]
  #for p in section.paragraphs [
    #block(below: 8pt)[
      #set par(justify: false, leading: 0.62em)
      #text(fill: ink)[#p]
    ]
  ]
  #v(4pt)
]

// ── Underskrifter ─────────────────────────────────────────────────────
//
// Kept off a page of its own where the contract will allow it, and never split
// down the middle. A signature block that lands alone on page three reads as an
// afterthought, and one whose two halves fall on different pages is a document
// somebody can sign without having seen the other party's name.
#v(10pt)
#block(breakable: false)[
  #text(size: heading-size, weight: "bold")[Underskrifter]
  #v(4pt)
  #text(size: table-size, fill: muted)[
    Avtalet upprättas i två exemplar, ett till vardera parten.
  ]
  #v(18pt)

  #let signature(role, party) = [
    #line(length: 100%, stroke: rule-hair)
    #v(4pt)
    #text(size: label-size, tracking: 0.6pt, weight: "bold")[#upper(role)] \
    #text(fill: ink)[#if party != none { party.name } else { text(fill: muted)[–] }] \
    #if party != none and party.title != none and party.title != "" [
      #text(size: table-size, fill: muted)[#party.title]
    ]
    #v(2pt)
    #text(size: label-size, fill: muted)[Ort och datum]
  ]

  #grid(
    columns: (1fr, 1fr),
    column-gutter: 28pt,
    signature("För uthyraren", data.sectionParty),
    signature("För hyrestagaren", data.counterpartyParty),
  )
]
