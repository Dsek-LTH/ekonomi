// Uthyrningsavtal: the document the section and a renter both put their name to.
//
// Everything it says arrives through `sys.inputs`, handed over by rental/typst.ts
// as one JSON string, so a render reads no file but this one and the mark it
// draws, and writes nothing at all. The same contract the utläggsräkning has
// with its own template.
//
// ── This is the guild's own house style, in Typst ─────────────────────
//
// The section publishes its LaTeX classes at Dsek-LTH/dsekdocs, and everything
// it issues (stadgar, policyer, protokoll, motioner) is set by dsekdoc.cls. A
// contract arriving in a different hand than the policy the same section
// published last month looks like it came from somewhere else. So this follows
// that class rather than inventing a look, and where a number below seems oddly
// specific it is because it is quoted from there:
//
//   Body            Domitian 11pt, old-style figures      \setmainfont
//   Headings        TeX Gyre Heros bold                   \c_dsek_section_format_tl
//   Text block      160mm wide, 230mm tall on A4          geometry
//   Paragraphs      no indent, 3mm between                \parindent, \parskip
//   Running head    sigil, guild name in small caps       \newpagestyle{main}
//   Footer          a hairline, then "2 (4)" centred      \setfootrule, \setfoot
//   Signatures      capacity, blank space, name, title    \signature in dsek.sty
//
// Both faces are vendored, for the reason lib/server/typst.ts gives: a document
// naming a face the machine lacks comes out in another one, silently.
//
// It was set in New Computer Modern before this, which was a reasonable guess
// at "looks like a contract" and the wrong answer to the actual question. The
// section has a house style; it is published; this is it.
//
// What is deliberately not taken from the class is the spacing inside the
// villkor. 3mm is its setting for running prose, and these are numbered terms
// each read on its own by somebody deciding whether to accept them.

#let data = json(bytes(sys.inputs.at("data")))

// ── The scale ─────────────────────────────────────────────────────────
//
// article at 11pt, which is what dsekdoc.cls passes to it. The steps are
// LaTeX's own relative sizes at that base: \small, \footnotesize, \Large,
// \LARGE.
#let body-size = 11pt
#let small-size = 10pt
#let foot-size = 9pt
#let section-size = 14.4pt
#let title-size = 17.3pt

// Black, and only black, as the class is. The one exception is a placeholder
// for something not filled in, which has to read as absent rather than as a
// value.
#let absent = luma(140)

// The class draws one hairline, above the footer. The tables want booktabs
// weights, which is the LaTeX convention it does not override.
#let hairline = 0.4pt + black
#let toprule = 0.9pt + black
#let midrule = 0.4pt + black
#let bottomrule = 0.9pt + black

// Domitian for text, with the old-style figures the class asks for
// (`Numbers=OldStyle`). They are the detail that most says whose document this
// is: Palatino with old-style figures is recognisably the section's before a
// word of it has been read.
#set text(
  font: ("Domitian", "Palatino", "Libertinus Serif"),
  size: body-size,
  number-type: "old-style",
  lang: "sv",
)

// The sans, for headings and the title.
#let sans = ("TeX Gyre Heros", "Helvetica", "Inter")

// No indent, a clear gap between, straight from the class (`\parindent{0mm}`,
// `\parskip{3mm}`). It is also what makes a numbered term read as a stop rather
// than as one more step in an argument.
#set par(justify: true, leading: 0.75em, spacing: 3mm)

// Lining, tabular figures: what a column of numbers wants, and what the class
// switches to inside its own tables (`Numbers={Monospaced,Lining}`). The
// old-style ones are for prose, where they sit among lowercase letters.
#let figures(body) = text(number-width: "tabular", number-type: "lining", body)

#set page(
  paper: "a4",
  // The class's geometry: a 160mm text block on a 210mm page leaves 25mm each
  // side. Down the page it is 1in less 15mm to the top of the head, a 16mm
  // head, 20mm of headsep and then 230mm of text, which puts the body 46.4mm
  // down and leaves 20.6mm at the foot.
  margin: (left: 25mm, right: 25mm, top: 46.4mm, bottom: 20.6mm),
  header-ascent: 20mm,
  footer-descent: 8mm,
  header: context {
    set text(size: small-size)
    set par(first-line-indent: 0pt, justify: false, leading: 0.5em, spacing: 0.5em)
    // `\setheadrule{0pt}`: nothing is drawn under the class's head.
    grid(
      columns: (auto, 1fr, auto),
      column-gutter: 6mm,
      align: (left + top, left + top, right + top),
      image("/public/symbol_real.svg", height: 16mm),
      [
        #smallcaps[D-sektionen inom TLTH] \
        #text(size: foot-size)[#smallcaps[#data.title]]
      ],
      [
        Uthyrningsavtal \
        #figures[#data.drawn]
      ],
    )
  },
  footer: context {
    set text(size: foot-size)
    set par(first-line-indent: 0pt, justify: false)
    // `\setfootrule{.4pt}`, then the page number centred as "2 (4)".
    stack(
      spacing: 2.5mm,
      line(length: 100%, stroke: hairline),
      align(center, figures[#counter(page).display("1 (1)", both: true)]),
    )
  },
)

#let orDash(v) = if v == none or v == "" { text(fill: absent)[--] } else { v }

// `\section`: \Large, sans, bold. Never orphaned at the foot of a page.
#let section(title) = block(above: 8mm, below: 3mm, breakable: false)[
  #text(font: sans, size: section-size, weight: "bold")[#title]
]

// A label and its value on one line, where the value is a date and stacking it
// would cost two lines to say three words.
#let inlineField(label, value) = [
  #text(size: small-size)[#smallcaps(label)]#h(0.6em)#value \
]

// ── Titeln ────────────────────────────────────────────────────────────
//
// `\maketitle` in the class is the title and nothing else: \LARGE, sans, bold,
// ranged left, then 0.75em of air. No rule, no centring, no date. Who issued
// this and when is the running head's job, on this page and on every other, so
// the first page does not spend three inches saying it a second time.
#text(font: sans, size: title-size, weight: "bold")[Uthyrningsavtal]
#v(0.75em)

#text(style: "italic")[#orDash(data.title)]

// ── Parterna ──────────────────────────────────────────────────────────
//
// Side by side and level with each other, because a contract's first question
// is who is bound by it and the answer is a pair. Uthyraren on the left, since
// that is the section, and a document is read from the side that issued it.
//
// The two columns are set identically, same order and same shape, so the eye
// compares them across rather than reading two blocks that happen to be
// adjacent. They hang from the same top line, so the renter's column being one
// line longer does not push the section's down.
#section[Parterna]

#let partyBlock(role, name, orgNoLabel, orgNo, address, postalLine, contact, party) = [
  #set par(first-line-indent: 0pt, justify: false, leading: 0.55em, spacing: 0.55em)
  #text(size: small-size)[#smallcaps(role)] \
  #text(weight: "bold")[#orDash(name)] \
  #set text(size: small-size)
  // The label differs by side, and not cosmetically: the section is always an
  // organisation and the renter is as often a private person, so this is the
  // one field where the two columns cannot say the same word.
  #if orgNo != none and orgNo != "" [
    #orgNoLabel #figures[#orgNo] \
  ]
  // The postal address, set as an address is: street, then postal code and
  // town. Each half prints on its own, since one of them is more use than
  // neither on a contract drawn before the form asked for either.
  #if address != none and address != "" [
    #address \
  ]
  #if postalLine != none and postalLine != "" [
    #postalLine \
  ]
  #if contact != none and contact != "" [
    #contact \
  ]
  // Who signs for this party, named here rather than only over the signature
  // line at the foot. An organisation cannot sign anything; a person signs on
  // its behalf, and a contract naming the organisation on page one and the
  // human being on page four has separated two facts that belong together.
  #if party != none [
    #v(1.5mm)
    #text(size: small-size)[#smallcaps("Representerad av")] \
    #if party.name != none and party.name != "" { party.name } else { text(fill: absent)[--] }
    #if party.title != none and party.title != "" [
      \ #text(style: "italic")[#party.title]
    ]
  ]
]

#grid(
  columns: (1fr, 1fr),
  column-gutter: 8mm,
  align: (left + top, left + top),
  partyBlock(
    "Uthyrare",
    data.lessor.name,
    "Org.nr",
    data.lessor.orgNo,
    data.lessor.address,
    data.lessor.postalLine,
    none,
    data.sectionParty,
  ),
  partyBlock(
    "Hyrestagare",
    data.counterparty,
    "Org./pers.nr",
    data.counterpartyOrgNo,
    data.counterpartyAddress,
    data.counterpartyPostalLine,
    // The renter's own contact details, where a signatory was named. This is
    // the one place on the page they appear, and they are here rather than in
    // the signature block because a party is identified once.
    if data.counterpartyParty != none {
      (data.counterpartyParty.email, data.counterpartyParty.phone)
        .filter(v => v != none and v != "")
        .join(" · ")
    } else { none },
    data.counterpartyParty,
  ),
)

// ── Hyresperioden ─────────────────────────────────────────────────────
#section[Hyresperiod]

#grid(
  columns: (1fr, 1fr, 1fr),
  column-gutter: 8mm,
  inlineField("Uthämtas", orDash(figures[#data.pickupAt])),
  inlineField("Återlämnas", orDash(figures[#data.returnAt])),
  inlineField("Plats", orDash(data.place)),
)

#if data.purpose != none and data.purpose != "" [
  #v(2mm)
  #block[
    #set par(first-line-indent: 0pt, justify: false)
    #inlineField("Ändamål", data.purpose)
  ]
]

// ── Utrustningen ──────────────────────────────────────────────────────
//
// The replacement value has a column of its own rather than a footnote. It is
// the figure the liability clause turns on, and a renter who signs without
// having seen what a speaker costs to replace has not really been told what
// they are agreeing to.
#section[Utrustning]

// The invoice's own arrangement, and the columns anybody has seen before:
// what it is, how many, what one costs, what came off, what that comes to. The
// replacement value is the sixth and not an invoice idea at all; it is the
// figure the liability clause turns on, and a renter who signs without having
// seen what a speaker costs to replace has not really been told what they are
// agreeing to.
//
// The discount column is drawn only when something was discounted. A column of
// dashes on the ordinary rental is a question asked of every reader and
// answered for none.
//
// No VAT column, and a line under the total saying why. The section is
// momsbefriad, so a VAT row would read 0,00 kr on every contract it ever
// issues, and a document reporting 0 % moms looks like one where somebody
// forgot to fill it in.
#let money-cols = if data.anyDiscount { 6 } else { 5 }

#block[
#set text(size: small-size)
#set par(first-line-indent: 0pt, justify: false)
#table(
  columns: if data.anyDiscount {
    (1fr, auto, auto, auto, auto, auto)
  } else {
    (1fr, auto, auto, auto, auto)
  },
  align: (left + top, right + top, right + top, right + top, right + top, right + top),
  stroke: none,
  // Roomier rows. An invoice is read one line at a time, and 5pt of leading put
  // six of them close enough together that the eye had to work to stay on one.
  inset: (x: 0pt, y: 8pt),
  column-gutter: 6mm,
  table.hline(stroke: toprule),
  table.header(
    [Utrustning],
    [Antal],
    [À-pris],
    ..if data.anyDiscount { ([Rabatt],) } else { () },
    [Belopp],
    [Återanskaffning],
  ),
  table.hline(stroke: midrule),
  ..data.lines
    .map(l => (
      [#l.description],
      figures[#l.quantity],
      figures[#l.unitPrice],
      ..if data.anyDiscount {
        (figures[#if l.discount != none { l.discount } else { text(fill: absent)[--] }],)
      } else { () },
      figures[#l.lineTotal],
      figures[#l.replacementValue],
    ))
    .flatten(),
  table.hline(stroke: midrule),
  // The totals row. Only two of the columns carry one: what the lines come to
  // and what is at stake. A sum under "Antal" would be a number nobody has a
  // use for, and what is actually owed is worked out below, where the discount
  // can be shown coming off.
  [Totalt],
  [], [],
  ..if data.anyDiscount { ([],) } else { () },
  figures[#data.subtotal],
  figures[#data.totalReplacement],
  table.hline(stroke: bottomrule),
)
]

#v(8mm)

// The rent, set like the foot of an invoice under the table it comes out of, so
// the arithmetic is followed down one column rather than looked up in two
// places. The discount is shown only when there is one: a line reading "Rabatt
// 0,00 kr" invites the reader to wonder what it was meant to say.
#align(right)[
  #block(width: 52%)[
    #set par(first-line-indent: 0pt, justify: false)
    #set text(size: small-size)
    #grid(
      columns: (1fr, auto),
      column-gutter: 8mm,
      row-gutter: 3.5mm,
      ..if data.discount != none {
        (
          [Delsumma], figures[#data.subtotal],
          [Rabatt], figures[#sym.minus#data.discount],
          grid.cell(colspan: 2, line(length: 100%, stroke: midrule)),
        )
      } else { () },
      text(weight: "bold")[Hyra],
      figures(text(weight: "bold")[#data.price]),
      // Under the figure it is the date for. Left off when there is none, which
      // the villkor read as "at pickup" rather than as an omission.
      ..if data.paymentDue != none {
        ([Betalas senast], figures[#data.paymentDue])
      } else { () },
      grid.cell(colspan: 2, line(length: 100%, stroke: hairline)),
      grid.cell(colspan: 2, text(size: foot-size, fill: absent)[
        Moms redovisas inte. Uthyraren är momsbefriad.
      ]),
    )
  ]
]

#v(4mm)

// ── Villkor ───────────────────────────────────────────────────────────
//
// Numbered, because the clauses are what a dispute points at and "punkt 5" has
// to mean something. The numbering is drawn from the order of the clauses
// rather than written into the text, so inserting one renumbers the rest.

// A term's table. Two columns, booktabs rules, a step down from the body, and
// indented from the left margin so it reads as evidence inside the numbered
// term above it rather than as a new section.
#let termsTable(head, rows) = block(above: 3mm, below: 3mm, breakable: false)[
  #pad(left: 6mm)[
    #set text(size: small-size)
    #set par(justify: false, first-line-indent: 0pt, leading: 0.55em, spacing: 0.55em)
    #table(
      columns: (auto, 1fr),
      align: (left + top, left + top),
      stroke: none,
      inset: (x: 0pt, y: 4pt),
      column-gutter: 8mm,
      table.hline(stroke: toprule),
      table.header(..head.map(h => text(weight: "bold")[#h])),
      table.hline(stroke: midrule),
      ..rows.flatten(),
      table.hline(stroke: bottomrule),
    )
  ]
]

// A term's list. For examples rather than steps, so the marker is a plain
// bullet and nothing is numbered: numbering inside a clause would compete with
// the clause numbers themselves.
#let termsList(items) = block(above: 2.5mm, below: 2.5mm)[
  #pad(left: 6mm)[
    #set par(justify: false, first-line-indent: 0pt, leading: 0.6em, spacing: 1.5mm)
    #for item in items [
      #grid(
        columns: (auto, 1fr),
        column-gutter: 0.7em,
        [#sym.bullet], [#item],
      )
    ]
  ]
]

#section[Villkor]

#for (i, clause) in data.terms.enumerate() [
  #block(above: 5mm, below: 2mm, breakable: false)[
    #text(font: sans, weight: "bold")[#(i + 1).#h(0.6em)#clause.heading]
  ]
  #for part in clause.body {
    if part.kind == "text" { par(part.text) }
    else if part.kind == "table" { termsTable(part.head, part.rows) }
    else if part.kind == "list" { termsList(part.items) }
  }
]

// ── Underskrifter ─────────────────────────────────────────────────────
//
// The class's own signature block (`\signature` in dsek.sty): the capacity on
// top, then 15mm of nothing to sign in, then the name, then what they are. No
// rule under the space, which is the detail that makes it look like the
// section's protokoll rather than like a form downloaded from somewhere.
//
// Kept off a page of its own where the contract will allow it, and never split
// down the middle. A signature block landing alone on the last page reads as an
// afterthought, and one whose two halves fall on different pages is a document
// somebody can sign without having seen the other party's name.
#block(above: 8mm, breakable: false)[
  #text(font: sans, size: section-size, weight: "bold")[Underskrifter]
  #v(3mm)
  #block[
    #set par(first-line-indent: 0pt)
    Avtalet upprättas i två exemplar, ett till vardera parten. Genom att
    underteckna bekräftar parterna att de har tagit del av och accepterar
    villkoren ovan.
  ]
  #v(6mm)

  #let signature(role, party) = [
    #set par(first-line-indent: 0pt, justify: false, leading: 0.55em, spacing: 0.55em)
    #text(size: small-size)[#smallcaps(role)] \
    // The space they sign in. 15mm, from `\g_dsek_sign_space_height`.
    #v(15mm)
    #if party != none and party.name != none and party.name != "" {
      party.name
    } else { text(fill: absent)[--] } \
    #if party != none and party.title != none and party.title != "" [
      #text(size: small-size, style: "italic")[#party.title] \
    ]
    #text(size: foot-size, fill: absent)[Ort och datum]
  ]

  #grid(
    columns: (1fr, 1fr),
    column-gutter: 8mm,
    align: (left + top, left + top),
    signature("För uthyraren", data.sectionParty),
    signature("För hyrestagaren", data.counterpartyParty),
  )
]
