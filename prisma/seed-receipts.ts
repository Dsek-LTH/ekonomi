// Receipt images for the seed. Every utlägg the app could have produced has a
// receipt (submitBlocker refuses one without), so every seeded one gets an
// image of its own, drawn from its own merchant, date, lines and total. That
// way the receipt beside the kontering says what the kontering is about.
//
// A till slip, set in a monospace face on white, photographed slightly askew
// on a grey table. Rendered from SVG with sharp, which the app already uses to
// normalise uploads, so nothing new is installed for it.
import sharp from "sharp";

export interface ReceiptSpec {
  merchant: string;
  /** A street and town, under the name. */
  address: string;
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM, printed beside the date. */
  time: string;
  /** SEK, negative on a return slip. They sum to the total. */
  lines: { name: string; amount: number }[];
  /** How it was paid, as the slip says it: "KORT ****8842", "SWISH". */
  paidWith: string;
  /** Turns the slip a little. Derived from the utlägg, so a reseed draws it the same. */
  seed: number;
}

const WIDTH = 520;
const PAD = 36;
const LINE = 30;
const COLS = 34; // characters across, in the body face

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const kr = (sek: number) =>
  sek.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/−/g, "-");

// A row with the name on the left and the amount on the right, as a till
// prints it: padded out to the full width in one monospace line.
function row(left: string, right: string): string {
  const room = COLS - right.length - 1;
  const name = left.length > room ? left.slice(0, room - 1) + "." : left;
  return name.padEnd(room, " ") + " " + right;
}

function receiptSvg(spec: ReceiptSpec): { svg: string; height: number } {
  const total = spec.lines.reduce((s, l) => s + l.amount, 0);
  // A section's purchases carry 25 % moms on most things, which the slip
  // states as the share of the total it is.
  const vat = Math.round((total / 5) * 100) / 100;
  const body = [
    ...spec.lines.map((l) => row(l.name, kr(l.amount))),
    "-".repeat(COLS),
    row("TOTALT SEK", kr(total)),
    row("Varav moms 25 %", kr(vat)),
    "",
    row(spec.paidWith, kr(total)),
    "",
    `${spec.date}  ${spec.time}`,
  ];
  const header = 3;
  const height = PAD * 2 + (header + body.length + 2) * LINE;
  const text = (y: number, s: string, attrs = "") =>
    `<text x="${PAD}" y="${y}" ${attrs}>${escape(s)}</text>`;
  const centred = (y: number, s: string, attrs = "") =>
    `<text x="${WIDTH / 2}" y="${y}" text-anchor="middle" ${attrs}>${escape(s)}</text>`;

  const rows: string[] = [
    centred(PAD + LINE, spec.merchant.toUpperCase(), 'font-size="26" font-weight="bold"'),
    centred(PAD + LINE * 2, spec.address, 'font-size="18"'),
    centred(PAD + LINE * 3, "KVITTO", 'font-size="18" letter-spacing="4"'),
    ...body.map((s, i) => text(PAD + LINE * (header + 2 + i), s, 'font-size="19"')),
    centred(height - PAD, "Tack för ditt köp!", 'font-size="18"'),
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">
  <rect width="100%" height="100%" fill="#fbfaf6"/>
  <g font-family="DejaVu Sans Mono, Menlo, Consolas, monospace" fill="#2a2a2a" xml:space="preserve">
    ${rows.join("\n    ")}
  </g>
</svg>`;
  return { svg, height };
}

/** The slip as a JPEG photo: the paper, turned a degree or two, on a table. */
export async function renderReceipt(spec: ReceiptSpec): Promise<Buffer> {
  const { svg } = receiptSvg(spec);
  // Between -2.5 and 2.5 degrees, either way.
  const angle = ((spec.seed % 1000) / 1000) * 5 - 2.5;
  const paper = await sharp(Buffer.from(svg))
    .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const { width = WIDTH, height = 800 } = await sharp(paper).metadata();
  const margin = 70;
  return sharp({
    create: {
      width: width + margin * 2,
      height: height + margin * 2,
      channels: 3,
      background: { r: 118, g: 121, b: 126 },
    },
  })
    .composite([{ input: paper, left: margin, top: margin }])
    .jpeg({ quality: 86 })
    .toBuffer();
}
