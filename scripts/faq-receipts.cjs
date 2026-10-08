// Draws the six example receipts on the FAQ page (see faq-content/examples-*.json)
// for a made-up shop, and writes them to public/faq/receipts/ as PNGs.
//
//   node scripts/faq-receipts.cjs
//
// Drawn rather than photographed: a real receipt is somebody's photo and some
// real shop's details, and it almost never shows exactly the one defect its
// answer is about. Each of these does, and nothing else. Every one carries an
// EXEMPEL watermark so it cannot be mistaken for a receipt that exists.
//
// Fonts are Menlo and Helvetica, which macOS has. Elsewhere librsvg falls back
// to whatever monospace and sans-serif fontconfig finds.
const path = require("path");
const sharp = require("sharp");
const OUT = path.join(__dirname, "..", "public", "faq", "receipts");
require("fs").mkdirSync(OUT, { recursive: true });

const W = 900, H = 1200;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── A thermal till receipt, as a list of lines ──
// Each line: ["c", text] centred, ["l", left, right] spread, ["-"] rule,
// ["b", text] bold centred, [" "] blank.
function thermal(lines, { width = 540, font = 21, lh = 31 } = {}) {
  const x0 = (W - width) / 2, pad = 34;
  const height = lines.length * lh + 2 * pad + 20;
  // Centred in the frame, the way a receipt is laid down to be photographed.
  const top = Math.max(40, Math.round((H - height) / 2) - 10);
  let y = top + pad + font;
  const out = [];
  for (const ln of lines) {
    const [k, a, b] = ln;
    if (k === "c" || k === "b")
      out.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-weight="${k === "b" ? "bold" : "normal"}" font-size="${k === "b" ? font + 4 : font}">${esc(a)}</text>`);
    else if (k === "l") {
      out.push(`<text x="${x0 + pad}" y="${y}">${esc(a)}</text>`);
      if (b) out.push(`<text x="${x0 + width - pad}" y="${y}" text-anchor="end">${esc(b)}</text>`);
    } else if (k === "-")
      out.push(`<line x1="${x0 + pad}" x2="${x0 + width - pad}" y1="${y - font / 3}" y2="${y - font / 3}" stroke="#555" stroke-dasharray="6 5"/>`);
    y += lh;
  }
  // A torn-paper zigzag along the bottom edge.
  const bottom = top + height;
  let zig = `M${x0},${top} H${x0 + width} V${bottom}`;
  for (let x = x0 + width; x > x0; x -= 18) zig += ` L${x - 9},${bottom + 8} L${x - 18},${bottom}`;
  zig += " Z";
  return { paper: `<path d="${zig}" fill="#fdfdfb" filter="url(#sh)"/>`, text: out.join("\n"), bottom };
}

function page(body, { bg = "#e4e0d8" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-opacity="0.18"/></filter></defs>
<rect width="100%" height="100%" fill="${bg}"/>
${body}
<g transform="translate(${W / 2} ${H / 2}) rotate(-28)"><text x="0" y="0" text-anchor="middle" font-family="Helvetica" font-weight="bold" font-size="150" fill="#c0392b" fill-opacity="0.13" letter-spacing="12">EXEMPEL</text></g>
</svg>`;
}

// ── The shared till receipt: everything bokföringslagen asks for ──
const items = [
  ["l", "Engångsmuggar 50 st"], ["l", "  2 x 34,90", "69,80"],
  ["l", "Servetter 100 st", "24,90"],
  ["l", "Kaffe mellanrost 500 g"], ["l", "  2 x 54,90", "109,80"],
  ["l", "Mjölk 1,5 l"], ["l", "  3 x 17,50", "52,50"],
];
// 25 %: 94,70 incl → moms 18,94. 12 %: 162,30 incl → moms 17,39.
const totals = [
  ["-"], ["l", "TOTALT SEK", "257,00"], [" "],
  ["l", "Moms%    Moms    Netto", ""],
  ["l", "25,00   18,94    75,76", ""],
  ["l", "12,00   17,39   144,91", ""],
  ["-"], ["l", "Kort Visa", "257,00"], [" "],
];
const seller = [
  ["b", "EXEMPELBUTIKEN AB"], ["c", "Exempelgatan 1"], ["c", "223 50 Lund"],
  ["c", "Org.nr 556000-0000"], [" "],
];
const footer = [
  ["l", "2026-10-05  14:32", "Kassa 2"], ["l", "Kvitto nr", "004812"], [" "],
  ["c", "Tack för ditt köp!"],
];
const validLines = [...seller, ["-"], ...items, ...totals, ...footer];

function till(lines) {
  const r = thermal(lines);
  return page(`${r.paper}<g font-family="Menlo" font-size="21" fill="#222" xml:space="preserve">${r.text}</g>`);
}

// ── A web-shop receipt, as an A4-ish page ──
function webshop() {
  const x = 120, w = 660, top = 90;
  const t = (y, s, o = "") => `<text x="${x + 50}" y="${y}" ${o}>${esc(s)}</text>`;
  const r = (y, s, o = "") => `<text x="${x + w - 50}" y="${y}" text-anchor="end" ${o}>${esc(s)}</text>`;
  const rows = [
    ["Förlängningssladd 10 m", "1", "249,00"],
    ["Grenuttag 6-vägs", "2", "318,00"],
    ["Buntband 100 st", "1", "59,00"],
  ];
  let y = top + 420;
  const lines = rows.map(([n, q, s]) => { const o = `${t(y, n)}<text x="${x + 430}" y="${y}" text-anchor="end">${q}</text>${r(y, s)}`; y += 40; return o; }).join("");
  const body = `
<rect x="${x}" y="${top}" width="${w}" height="1000" fill="#fff" filter="url(#sh)"/>
<g font-family="Helvetica" fill="#222" font-size="20">
${t(top + 70, "Exempelhandeln AB", 'font-size="30" font-weight="bold"')}
${t(top + 100, "Exempelvägen 12, 114 50 Stockholm", 'fill="#666"')}
${t(top + 126, "Org.nr 556000-1111  |  Momsreg.nr SE556000111101", 'fill="#666" font-size="17"')}
${r(top + 70, "KVITTO", 'font-size="30" font-weight="bold" fill="#2a6f4f"')}
${t(top + 190, "Kvittonummer", 'fill="#666" font-size="17"')}${t(top + 215, "W-2026-10457", 'font-weight="bold"')}
<text x="${x + 330}" y="${top + 190}" fill="#666" font-size="17">Datum</text><text x="${x + 330}" y="${top + 215}" font-weight="bold">2026-10-03</text>
${t(top + 265, "Köpare", 'fill="#666" font-size="17"')}${t(top + 290, "D-sektionen inom TLTH")}${t(top + 314, "Box 118, 221 00 Lund")}
<line x1="${x + 50}" x2="${x + w - 50}" y1="${top + 345}" y2="${top + 345}" stroke="#ccc"/>
${t(top + 375, "Artikel", 'fill="#666" font-size="17"')}<text x="${x + 430}" y="${top + 375}" text-anchor="end" fill="#666" font-size="17">Antal</text>${r(top + 375, "Belopp", 'fill="#666" font-size="17"')}
${lines}
<line x1="${x + 50}" x2="${x + w - 50}" y1="${y - 10}" y2="${y - 10}" stroke="#ccc"/>
${t(y + 25, "Varav moms 25 %")}${r(y + 25, "125,20")}
${t(y + 55, "Netto")}${r(y + 55, "500,80")}
${t(y + 95, "Totalt SEK", 'font-weight="bold" font-size="24"')}${r(y + 95, "626,00", 'font-weight="bold" font-size="24"')}
${t(y + 150, "Betalt med kort 2026-10-03. Tack för din beställning.", 'fill="#666" font-size="17"')}
</g>`;
  return page(body);
}

// ── An order confirmation e-mail ──
function orderConfirmation() {
  const x = 120, w = 660, top = 110;
  const t = (y, s, o = "") => `<text x="${x + 50}" y="${y}" ${o}>${esc(s)}</text>`;
  const r = (y, s, o = "") => `<text x="${x + w - 50}" y="${y}" text-anchor="end" ${o}>${esc(s)}</text>`;
  const body = `
<rect x="${x}" y="${top}" width="${w}" height="900" rx="10" fill="#fff" filter="url(#sh)"/>
<rect x="${x}" y="${top}" width="${w}" height="90" rx="10" fill="#3b5bdb"/><rect x="${x}" y="${top + 60}" width="${w}" height="30" fill="#3b5bdb"/>
<g font-family="Helvetica" fill="#222" font-size="20">
${t(top + 56, "exempelshop.se", 'fill="#fff" font-size="28" font-weight="bold"')}
${t(top + 160, "Tack för din beställning!", 'font-size="30" font-weight="bold"')}
${t(top + 200, "Vi har tagit emot din order och skickar den så snart", 'fill="#555"')}
${t(top + 226, "den är packad.", 'fill="#555"')}
${t(top + 290, "Ordernummer", 'fill="#666" font-size="17"')}${t(top + 316, "#58213", 'font-weight="bold"')}
<text x="${x + 330}" y="${top + 290}" fill="#666" font-size="17">Status</text><text x="${x + 330}" y="${top + 316}" font-weight="bold" fill="#b7791f">Behandlas</text>
<line x1="${x + 50}" x2="${x + w - 50}" y1="${top + 350}" y2="${top + 350}" stroke="#ddd"/>
${t(top + 390, "Förlängningssladd 10 m x 1")}${r(top + 390, "249 kr")}
${t(top + 430, "Grenuttag 6-vägs x 2")}${r(top + 430, "318 kr")}
${t(top + 470, "Buntband 100 st x 1")}${r(top + 470, "59 kr")}
<line x1="${x + 50}" x2="${x + w - 50}" y1="${top + 500}" y2="${top + 500}" stroke="#ddd"/>
${t(top + 540, "Att betala (inkl. moms)", 'font-weight="bold"')}${r(top + 540, "626 kr", 'font-weight="bold"')}
${t(top + 620, "Har du frågor om din order? Svara på det här mejlet.", 'fill="#666" font-size="17"')}
${t(top + 660, "Hälsningar, teamet på exempelshop.se", 'fill="#666" font-size="17"')}
</g>`;
  return page(body);
}

// ── A card terminal slip: the total and nothing else ──
const terminalLines = [
  ["b", "KÖP"], [" "],
  ["l", "Datum", "2026-10-05"], ["l", "Tid", "14:32"],
  ["l", "Term.id", "84512007"], ["l", "Butik", "EXEMPELBUTIKEN"],
  ["-"], ["l", "Visa", "**** 1234"], ["l", "Kontaktlös", ""], [" "],
  ["l", "BELOPP SEK", "257,00"], ["-"],
  ["c", "GODKÄND"], ["l", "Ref", "502811"], [" "],
  ["c", "Kundens exemplar"], ["c", "Spara kvittot"],
];

async function write(name, svg, post) {
  let img = sharp(Buffer.from(svg));
  if (post) img = await post(img);
  await img.png({ compressionLevel: 9 }).toFile(`${OUT}/${name}.png`);
  console.log("wrote", name);
}

(async () => {
  await write("valid-store", till(validLines));
  await write("valid-webshop", webshop());
  await write("invalid-order-confirmation", orderConfirmation());
  // The same receipt, the seller's block gone.
  await write("invalid-no-seller", till([["b", "KVITTO"], [" "], ["-"], ...items, ...totals, ...footer]));
  await write("invalid-no-vat", till(terminalLines));
  // The valid receipt photographed badly: tilted, out of focus, the bottom
  // (totals, VAT and receipt number) outside the frame.
  await write("invalid-unreadable", till(validLines), async (img) => {
    const buf = await img.png().toBuffer();
    const tilted = await sharp(buf).rotate(7, { background: "#e4e0d8" }).blur(4.2).toBuffer();
    const meta = await sharp(tilted).metadata();
    const left = Math.round((meta.width - W) / 2);
    // Shift the frame down so the top is in view and the bottom is cut off.
    return sharp(tilted).extract({ left, top: Math.round(meta.height * 0.0), width: W, height: Math.round(H * 0.62) })
      .resize(W, H, { fit: "cover", position: "top" });
  });
})();
