// The HTML drawing of an email, as React Email components.
//
// React Email's components are what make JSX safe to send: Section, Row and
// Column come out as the nested tables Outlook on Windows needs (it renders
// with Word and knows no flexbox), Button carries the extra markup Outlook
// needs to honour its padding, and Preview is the line an inbox shows under
// the subject. Every style is inline because Gmail strips <style>, which is
// also why nothing here is a class.
//
// The look follows the reviewed designs: the app's own greys, the brand pink
// for action, amber for "something went backwards", the card blue. One
// component per kind of block, and EmailDocument to put a whole mail together.
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link as A,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";
import type { CSSProperties, ReactNode } from "react";
import { LOGO_CID, type Block, type Email, type Link, type TagTone, type Tone } from "./types";

// ── Palette, from the app's own tokens (src/app/globals.css) ──────

const C = {
  ground: "#f5f5f7",
  card: "#ffffff",
  border: "#e5e5ea",
  text: "#1d1d1f",
  body: "#3a3a3c",
  muted: "#6e6e73",
  action: "#c93663",
  actionSoft: "#fdf1f5",
  warning: "#9a6700",
  warningSoft: "#fff8e7",
  cardBlue: "#1d4ed8",
  cardSoft: "#eef2fd",
  success: "#248a3d",
};

const ACCENT: Record<Tone, string> = { action: C.action, warning: C.warning, card: C.cardBlue };
const SOFT: Record<Tone | "neutral", string> = {
  neutral: C.ground,
  action: C.actionSoft,
  warning: C.warningSoft,
  card: C.cardSoft,
};
const STRONG: Record<Tone | "neutral", string> = {
  neutral: C.text,
  action: C.action,
  warning: C.warning,
  card: C.cardBlue,
};

/** The payment-type tags the app draws, in the app's colours. */
const TAG: Record<TagTone, { color: string; background: string }> = {
  CARD: { color: "#1d4ed8", background: "#eef2fd" },
  REIMBURSEMENT: { color: "#0f766e", background: "#ecf8f5" },
  MILEAGE: { color: "#7c4a1e", background: "#f9f1e9" },
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif";

// React Email's Text comes with a margin and a line height of its own; every
// use here sets both, so this is the reset they start from.
const t = (style: CSSProperties): CSSProperties => ({ margin: 0, fontFamily: FONT, ...style });

const muted = t({ fontSize: 12, lineHeight: "18px", color: C.muted });
const box: CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 6, borderCollapse: "separate" };
const ruled = (first: boolean): CSSProperties => (first ? {} : { borderTop: `1px solid ${C.border}` });

/**
 * A few cells side by side, only as wide as what is in them: the logo beside
 * the name, the initials beside the author. React Email's Row always spans the
 * full width, which spreads its cells out and centres them.
 */
function Inline({ children }: { children: ReactNode }) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0}>
      <tbody>
        <tr>{children}</tr>
      </tbody>
    </table>
  );
}

function ActionButton({ link }: { link: Link }) {
  return (
    <Button
      href={link.url}
      style={{
        backgroundColor: C.action,
        borderRadius: 6,
        color: "#ffffff",
        fontFamily: FONT,
        fontSize: 15,
        fontWeight: 600,
        lineHeight: "20px",
        padding: "13px 22px",
        textDecoration: "none",
      }}
    >
      {link.label}
    </Button>
  );
}

// ── Blocks ────────────────────────────────────────────────────────

function ExpenseCard({ block }: { block: Extract<Block, { kind: "expense" }> }) {
  // Two facts to a row, the way the design lays them out.
  const rows: (typeof block.facts)[] = [];
  block.facts.forEach((f, i) => (i % 2 ? rows[rows.length - 1].push(f) : rows.push([f])));
  return (
    <Section style={{ backgroundColor: C.ground, borderRadius: 6, padding: 20 }}>
      <Row>
        <Column style={{ verticalAlign: "bottom" }}>
          {block.reference && <Text style={t({ fontSize: 13, lineHeight: "18px", color: C.muted })}>{block.reference}</Text>}
          <Text style={t({ fontSize: 16, lineHeight: "22px", fontWeight: 600, color: C.text })}>{block.title}</Text>
        </Column>
        <Column align="right" style={{ verticalAlign: "bottom", whiteSpace: "nowrap", paddingLeft: 16 }}>
          <Text style={t({ fontSize: 20, lineHeight: "26px", fontWeight: 600, color: C.text })}>{block.amount}</Text>
        </Column>
      </Row>
      {rows.length > 0 && <Hr style={{ borderColor: C.border, margin: "12px 0 6px" }} />}
      {rows.map((pair, i) => (
        <Row key={i}>
          {pair.map((f) => (
            <Column key={f.label} style={{ width: "50%", verticalAlign: "top", padding: "6px 8px 6px 0" }}>
              <Text style={muted}>{f.label}</Text>
              {f.tag ? (
                <Text style={t({ paddingTop: 4, fontSize: 12, lineHeight: "16px" })}>
                  <span style={{ ...TAG[f.tag], fontWeight: 600, padding: "2px 8px", borderRadius: 4 }}>{f.value}</span>
                </Text>
              ) : (
                <Text style={t({ paddingTop: 2, fontSize: 14, lineHeight: "20px", color: C.text })}>{f.value}</Text>
              )}
            </Column>
          ))}
          {pair.length === 1 && <Column style={{ width: "50%" }} />}
        </Row>
      ))}
    </Section>
  );
}

function Comment({ block }: { block: Extract<Block, { kind: "comment" }> }) {
  const initials = block.author
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <Section style={{ backgroundColor: C.warningSoft, borderRadius: 6, padding: "18px 20px" }}>
      <Inline>
        <td
          align="center"
          style={{ width: 26, height: 26, backgroundColor: C.warning, borderRadius: 13, verticalAlign: "middle" }}
        >
          <Text style={t({ fontSize: 11, lineHeight: "26px", fontWeight: 600, color: "#ffffff" })}>{initials}</Text>
        </td>
        <td style={{ paddingLeft: 8, verticalAlign: "middle" }}>
          <Text style={t({ fontSize: 13, lineHeight: "18px", fontWeight: 600, color: C.text })}>{block.author}</Text>
        </td>
        <td style={{ paddingLeft: 8, verticalAlign: "middle" }}>
          <Text style={muted}>{block.when}</Text>
        </td>
      </Inline>
      <Text style={t({ paddingTop: 8, fontSize: 15, lineHeight: "23px", color: C.text, whiteSpace: "pre-line" })}>
        {block.text}
      </Text>
    </Section>
  );
}

function More({ text }: { text?: string }) {
  return text ? <Text style={t({ paddingTop: 8, fontSize: 13, lineHeight: "18px", color: C.muted })}>{text}</Text> : null;
}

function TransactionTable({ block }: { block: Extract<Block, { kind: "transactions" }> }) {
  const head = t({ fontSize: 12, lineHeight: "16px", fontWeight: 600, color: C.muted });
  const cell: CSSProperties = { padding: "12px 16px", verticalAlign: "top" };
  return (
    <>
      <Section style={box}>
        <Row style={{ backgroundColor: C.ground }}>
          <Column style={{ padding: "10px 16px", width: 96 }}><Text style={head}>{block.head.date}</Text></Column>
          <Column style={{ padding: "10px 16px" }}><Text style={head}>{block.head.description}</Text></Column>
          <Column align="right" style={{ padding: "10px 16px" }}><Text style={head}>{block.head.amount}</Text></Column>
        </Row>
        {block.rows.map((r, i) => (
          <Row key={i}>
            <Column style={{ ...cell, ...ruled(false), width: 96, whiteSpace: "nowrap" }}>
              <Text style={t({ fontSize: 14, lineHeight: "20px", color: C.muted })}>{r.date}</Text>
            </Column>
            <Column style={{ ...cell, ...ruled(false) }}>
              <Text style={t({ fontSize: 14, lineHeight: "20px", color: C.text })}>{r.description}</Text>
              {r.refund && (
                <Text style={t({ fontSize: 12, lineHeight: "16px", fontWeight: 600, color: C.success })}>
                  {block.refundLabel}
                </Text>
              )}
            </Column>
            <Column align="right" style={{ ...cell, ...ruled(false), whiteSpace: "nowrap" }}>
              <Text style={t({ fontSize: 14, lineHeight: "20px", fontWeight: 600, color: r.refund ? C.success : C.text })}>
                {r.amount}
              </Text>
            </Column>
          </Row>
        ))}
      </Section>
      <More text={block.more} />
    </>
  );
}

function Stats({ block }: { block: Extract<Block, { kind: "stats" }> }) {
  // Percentages for the gaps as well as the counters: a fixed-width cell
  // beside percentage ones is the first thing a client squeezes. The colour is
  // on the cells themselves, so a label that wraps in one counter does not
  // leave the others short.
  const GAP = 3;
  const width = `${Math.floor((100 - GAP * (block.items.length - 1)) / block.items.length)}%`;
  return (
    <Row>
      {block.items.flatMap((s, i) => [
        ...(i ? [<Column key={`gap${i}`} style={{ width: `${GAP}%` }} />] : []),
        <Column
          key={s.label}
          style={{ width, verticalAlign: "top", backgroundColor: SOFT[s.tone], borderRadius: 6, padding: "14px 16px" }}
        >
          <Text style={t({ fontSize: 26, lineHeight: "32px", fontWeight: 600, color: STRONG[s.tone] })}>{s.value}</Text>
          <Text style={t({ paddingTop: 4, fontSize: 12, lineHeight: "16px", color: C.muted })}>{s.label}</Text>
        </Column>,
      ])}
    </Row>
  );
}

function ItemList({ block }: { block: Extract<Block, { kind: "list" }> }) {
  return (
    <>
      <Section style={box}>
        {block.rows.map((r, i) => (
          <Row key={i}>
            <Column style={{ padding: "12px 16px", ...ruled(i === 0) }}>
              <Text style={t({ fontSize: 14, lineHeight: "20px", fontWeight: 600, color: C.text })}>{r.title}</Text>
              {r.sub && <Text style={t({ paddingTop: 2, fontSize: 12, lineHeight: "16px", color: C.muted })}>{r.sub}</Text>}
            </Column>
            <Column align="right" style={{ padding: "12px 16px", verticalAlign: "middle", whiteSpace: "nowrap", ...ruled(i === 0) }}>
              {r.pill ? (
                <Text style={t({ fontSize: 12, lineHeight: "16px" })}>
                  <span style={{ backgroundColor: C.warningSoft, color: C.warning, fontWeight: 600, padding: "3px 8px", borderRadius: 4 }}>
                    {r.pill}
                  </span>
                </Text>
              ) : r.amount ? (
                <Text style={t({ fontSize: 14, lineHeight: "20px", fontWeight: 600, color: C.text })}>{r.amount}</Text>
              ) : null}
            </Column>
          </Row>
        ))}
      </Section>
      <More text={block.more} />
    </>
  );
}

function DigestSection({ block }: { block: Extract<Block, { kind: "section" }> }) {
  return (
    <Section>
      <Text style={t({ fontSize: 17, lineHeight: "24px", fontWeight: 600, color: C.text })}>{block.title}</Text>
      {block.hint && <Text style={t({ paddingTop: 4, fontSize: 14, lineHeight: "21px", color: C.muted })}>{block.hint}</Text>}
      {block.blocks.map((inner, i) => (
        <Section key={i} style={{ paddingTop: 12 }}>
          <BlockView block={inner} />
        </Section>
      ))}
      {block.link && (
        <Text style={t({ paddingTop: 12, fontSize: 14, lineHeight: "20px" })}>
          <A href={block.link.url} style={{ color: C.action, fontWeight: 600, textDecoration: "none" }}>
            {block.link.label} &rarr;
          </A>
        </Text>
      )}
      {block.button && (
        <Section style={{ paddingTop: 16 }}>
          <ActionButton link={block.button} />
        </Section>
      )}
    </Section>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "expense":
      return <ExpenseCard block={block} />;
    case "comment":
      return <Comment block={block} />;
    case "transactions":
      return <TransactionTable block={block} />;
    case "stats":
      return <Stats block={block} />;
    case "list":
      return <ItemList block={block} />;
    case "section":
      return <DigestSection block={block} />;
  }
}

// ── The whole mail ────────────────────────────────────────────────

export function EmailDocument({
  email: e,
  logoSrc = `cid:${LOGO_CID}`,
}: {
  email: Email;
  /** Where the logo comes from. The attachment in a sent mail; a file in the
   *  preview server (emails/), which has no attachments to point at. */
  logoSrc?: string;
}) {
  const accent = ACCENT[e.tone];
  return (
    <Html lang="sv">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{e.subject}</title>
      </Head>
      <Preview>{e.intro ?? e.heading}</Preview>
      <Body style={{ margin: 0, padding: "32px 16px", backgroundColor: C.ground, fontFamily: FONT }}>
        <Container style={{ maxWidth: 560, width: "100%" }}>
          <Section
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderTop: `3px solid ${accent}`,
              borderRadius: 6,
              padding: 32,
            }}
          >
            <Row>
              <Column style={{ paddingBottom: 20, borderBottom: `1px solid ${C.border}`, verticalAlign: "middle" }}>
                <Inline>
                  <td style={{ verticalAlign: "middle" }}>
                    <Img src={logoSrc} alt="" width="21" height="28" style={{ display: "block" }} />
                  </td>
                  <td style={{ paddingLeft: 10, verticalAlign: "middle" }}>
                    <Text style={t({ fontSize: 15, lineHeight: "20px", fontWeight: 600, color: C.text })}>{e.brand.name}</Text>
                  </td>
                </Inline>
              </Column>
              <Column align="right" style={{ paddingBottom: 20, borderBottom: `1px solid ${C.border}`, verticalAlign: "middle" }}>
                <Text style={t({ fontSize: 13, lineHeight: "18px", color: C.muted })}>{e.brand.org}</Text>
              </Column>
            </Row>

            <Text
              style={t({
                paddingTop: 20,
                fontSize: 12,
                lineHeight: "16px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: accent,
              })}
            >
              {e.eyebrow}
            </Text>
            <Heading as="h1" style={t({ paddingTop: 8, fontSize: 24, lineHeight: "30px", fontWeight: 600, color: C.text })}>
              {e.heading}
            </Heading>
            {e.intro && <Text style={t({ paddingTop: 8, fontSize: 15, lineHeight: "23px", color: C.body })}>{e.intro}</Text>}

            {e.blocks.map((b, i) => {
              // Sections in the digest are set apart by a rule; anything else by space.
              const ruleBefore = b.kind === "section" && i > 0 && e.blocks[i - 1].kind === "section";
              return (
                <Section key={i} style={{ paddingTop: b.kind === "section" ? 24 : 20 }}>
                  {ruleBefore && <Hr style={{ borderColor: C.border, margin: "0 0 24px" }} />}
                  <BlockView block={b} />
                </Section>
              );
            })}

            {e.action && (
              <Section style={{ paddingTop: 20 }}>
                <ActionButton link={e.action} />
                {e.orOpen && <Text style={{ ...muted, paddingTop: 10, wordBreak: "break-all" }}>{e.orOpen}</Text>}
              </Section>
            )}
          </Section>

          <Section style={{ padding: "20px 4px 0" }}>
            <Text style={muted}>
              {e.footer.reason}{" "}
              <A href={e.footer.settings.url} style={{ color: C.action, textDecoration: "underline" }}>
                {e.footer.settings.label}
              </A>
            </Text>
            <Text style={{ ...muted, paddingTop: 6 }}>{e.footer.org}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
