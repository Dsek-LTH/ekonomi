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
//   Running head    sigil, guild name in bold capitals    \newpagestyle{main}
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
// The villkor are the one place the layout departs from the section's
// paragraphed documents (stadgar, reglemente). Those set "§ 1 Namn" in a
// column of its own beside the text, which at 160mm leaves the text about
// 100mm wide. Here the heading sits above its clause instead, with the
// spacing the class gives a \section, so the terms keep the full measure.

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
//
// The 3mm goes on top of the leading, not in place of it. LaTeX adds \parskip
// to the ordinary line pitch, while Typst's `spacing` replaces `leading`
// between two paragraphs. Set to 3mm on its own it came out 0.3pt wider than a
// line break, and the paragraphs ran together.
#let par-gap = 0.75em + 3mm
#set par(justify: true, leading: 0.75em, spacing: par-gap)

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
    // `\setheadrule{0pt}`: nothing is drawn under the class's head. The three
    // boxes are the class's own widths (`\parbox{18mm}`, `\parbox{80mm}`,
    // `\parbox{60mm}`), not a layout that stretches to fill the line: the
    // guild's own documents leave the gap between the short title and the
    // date rather than closing it, and this follows suit.
    //
    // Centred against the sigil, not hung from its top. A `\parbox` with no
    // position argument is centred on its line, so the class's three boxes sit
    // level with the middle of the 16mm sigil, and so do these.
    grid(
      columns: (18mm, 80mm, 1fr),
      column-gutter: 0pt,
      align: (left + horizon, left + horizon, right + horizon),
      image("/public/bw.svg", height: 16mm),
      [
        #text(weight: "bold")[#upper[D-sektionen inom TLTH]] \
        #text(size: small-size)[#smallcaps[#data.title]]
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

// `\section`: \Large, sans, bold. Never orphaned at the foot of a page: sticky
// keeps it on the same page as whatever follows it.
#let section(title) = block(above: 8mm, below: 3mm, breakable: false, sticky: true)[
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

#let partyBlock(role, name, orgNoLabel, orgNo, address, postalLine, contact) = [
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
  // How to reach them other than by post, on one line. Only the renter has
  // one: the section is reached through the address above.
  #if contact != none and contact != "" [
    #contact \
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
  ),
  partyBlock(
    "Hyrestagare",
    data.counterparty,
    "Org./pers.nr",
    data.counterpartyOrgNo,
    data.counterpartyAddress,
    data.counterpartyPostalLine,
    (data.counterpartyEmail, data.counterpartyPhone)
      .filter(v => v != none and v != "")
      .join(" - "),
  ),
)

// ── Hyresperioden ─────────────────────────────────────────────────────
#section[Hyresperiod]

#grid(
  columns: (1fr, 1fr),
  column-gutter: 8mm,
  inlineField("Uthämtas", orDash(figures[#data.pickupAt])),
  inlineField("Återlämnas", orDash(figures[#data.returnAt])),
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
    // Per unit, like the à-pris, since § 5 charges what one costs to replace.
    [Återanskaffningsvärde à st],
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
  // No totals row. What is owed is worked out under the table, where the
  // discount is shown coming off, and a sum here as well would be one more
  // figure for the same lines to disagree with.
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
    )
    // What is at stake, apart from what is owed. The renter pays it only under
    // § 6, never as rent, so it stands under the rent rather than in the sum.
    #v(5mm)
    #grid(
      columns: (1fr, auto),
      column-gutter: 8mm,
      [Återanskaffningsvärde totalt], figures[#data.totalReplacement],
    )
  ]
]

#v(4mm)

// ── Villkor ───────────────────────────────────────────────────────────
//
// Numbered, because the clauses are what a dispute points at and "§ 5" has to
// mean something. The numbering is drawn from the order of the clauses rather
// than written into the text, so inserting one renumbers the rest. The space
// after § is non-breaking, so the sign never ends a line without its number.

// A term's table. Two columns, booktabs rules, a step down from the body, and
// indented from the left margin so it reads as evidence inside the numbered
// term above it rather than as a new section.
//
// `lead` is a layout mark for the first header cell (see `mark` below), inline
// so it adds no line of its own.
#let termsTable(head, rows, lead: none) = block(above: 3mm, below: 3mm, breakable: false)[
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
      table.header(..head.enumerate().map(((k, h)) => text(weight: "bold")[#h#if k == 0 { lead }])),
      table.hline(stroke: midrule),
      ..rows.flatten(),
      table.hline(stroke: bottomrule),
    )
  ]
]

// A term's list. For examples rather than steps, so the marker is a plain
// bullet and nothing is numbered: numbering inside a clause would compete with
// the clause numbers themselves.
//
// `lead` is a layout mark for the first item, the same as `termsTable`'s.
#let termsList(items, lead: none) = block(above: 2.5mm, below: 2.5mm)[
  #pad(left: 6mm)[
    #set par(justify: false, first-line-indent: 0pt, leading: 0.6em, spacing: 1.5mm)
    #for (k, item) in items.enumerate() [
      #grid(
        columns: (auto, 1fr),
        column-gutter: 0.7em,
        [#sym.bullet], [#item#if k == 0 { lead }],
      )
    ]
  ]
]

#section[Villkor]

// Where a clause heading, a clause's first line, the last line of the villkor,
// a sentence introducing a table or a list, that table or list, and the
// signatures land, for page-layout.test.ts to ask Typst about. Invisible, and
// read by nothing else. Marks go inline, in a paragraph or a cell that is
// already there, because a mark on its own would be a paragraph of its own; the
// test knows which clauses to expect them on. `part` is the index of the text
// part a table or list is introduced by, so the two marks can be paired.
#let mark(kind, clause, part: none) = context [#metadata((kind: kind, clause: clause, part: part, page: here().page())) <layout>]

#for (i, clause) in data.terms.enumerate() [
  // More air above the heading than below it, so it reads as the start of the
  // clause under it rather than the end of the one before. dsekparagraphed.cls
  // does it the other way round for \section (about 5mm above, 7.6mm below
  // once \parskip and \baselineskip are counted), and on a page of numbered
  // clauses that left each heading looking attached to the wrong one.
  //
  // Sticky, so a heading is never left at the foot of a page with its clause
  // starting on the next.
  #block(above: 7.6mm, below: 5mm, breakable: false, sticky: true)[
    #text(font: sans, weight: "bold")[§~#(i + 1)#h(0.6em)#clause.heading]#mark("head", i)
  ]
  #for (j, part) in clause.body.enumerate() {
    let closing = i == data.terms.len() - 1 and j == clause.body.len() - 1
    let next = clause.body.at(j + 1, default: none)
    // A sentence that introduces a table or a list ("Ersättningen beräknas så
    // här:") says nothing on its own, and left at the foot of a page it points
    // at a table the reader has to turn over to find.
    let leads = part.kind == "text" and next != none and next.kind != "text"
    let content = if part.kind == "text" {
      par({
        if j == 0 { mark("body", i) }
        part.text
        if closing { mark("end", i) }
        if leads { mark("lead", i, part: j) }
      })
    } else if part.kind == "table" { termsTable(part.head, part.rows, lead: mark("follows", i, part: j - 1)) }
    else if part.kind == "list" { termsList(part.items, lead: mark("follows", i, part: j - 1)) }
    // Two things are held to what follows them. The last part of the last
    // clause is held to the signatures below, so when they do not fit on the
    // page this part goes over with them and the signatures never stand on a
    // page with no villkor on it. And a sentence introducing a table or a list
    // is held to it. Wrapped rather than marked, because a paragraph cannot be
    // sticky and a block can.
    //
    // The gaps are the ones the part would have had unwrapped: its own above,
    // and below it the one the table or list after it asks for. Between two
    // blocks Typst keeps the larger gap, so the paragraph's own spacing below
    // the wrapper pushed an introduced table 8pt further off than it sat before.
    if closing or leads {
      let gap(kind) = if kind == "text" { par-gap } else if kind == "table" { 3mm } else { 2.5mm }
      let below = if leads { gap(next.kind) } else { gap(part.kind) }
      block(above: gap(part.kind), below: below, breakable: false, sticky: true, content)
    } else { content }
  }
]

// ── Underskrifter ─────────────────────────────────────────────────────
//
// Only the renter signs. What binds them to the villkor, replacement value
// included, is their own acceptance, not a countersignature from whoever at
// the section drew the contract up: avtalslagen asks for an accept, not a
// counterpart's signature, and the section's side of the deal is already
// evidenced by the document it issued.
//
// As many blocks as the contract asks for, two to a row. No names are
// printed: who signs for an organisation is rarely known when the contract is
// drawn, so each block has a line to write the name out on.
//
// The class's own signature block (`\signature` in dsek.sty) is the capacity
// on top and then 15mm of nothing to sign in. Under that come two ruled lines,
// for the name written out and for the place and date, since neither is known
// when the document is drawn.
//
// Never on a page of its own. A signature page with no villkor on it reads as
// an afterthought, and it is a page that could be swapped out without anybody
// noticing. The last part of the last clause is sticky (see the loop above), so
// when this block does not fit, that part goes over to the next page with it,
// however long the equipment table made the pages before. page-layout.test.ts
// holds this for every table length up to thirty lines.
#let signature-count = calc.max(1, data.signatureCount)

#let signature = block(breakable: false)[
  #set par(first-line-indent: 0pt, justify: false, leading: 0.55em, spacing: 0.55em)
  #text(size: small-size)[#smallcaps("För hyrestagaren")]
  // The space they sign in. 15mm, from `\g_dsek_sign_space_height`.
  #v(15mm)
  #line(length: 100%, stroke: hairline)
  #text(size: foot-size, fill: absent)[Namnförtydligande]
  #v(8mm)
  #line(length: 100%, stroke: hairline)
  #text(size: foot-size, fill: absent)[Ort och datum]
]

#let signature-rows(n) = grid(
  columns: (1fr, 1fr),
  column-gutter: 12mm,
  row-gutter: 10mm,
  ..range(n).map(_ => signature),
)

// In two parts, because sticky only holds to a block that cannot break. The
// first part never breaks: the heading, the sentence and the signatures, all of
// them up to four, or the first row of two when there are more. Anything past
// that follows as rows that may run onto the next page, which a long list of
// signatories has to be allowed to do.
#let kept = if signature-count <= 4 { signature-count } else { 2 }

#block(above: 8mm, breakable: false)[
  #text(font: sans, size: section-size, weight: "bold")[Underskrifter]#mark("signatures", none)
  #v(3mm)
  #block[
    #set par(first-line-indent: 0pt)
    Avtalet upprättas i två exemplar, ett till vardera parten. Genom att
    underteckna bekräftar hyrestagaren att denne har tagit del av och
    accepterar villkoren ovan.
  ]
  #v(6mm)
  #signature-rows(kept)
]

#if signature-count > kept {
  block(above: 10mm, signature-rows(signature-count - kept))
}
