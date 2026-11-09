import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "D-sektionen | Ekonomi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const svg = (await readFile(join(process.cwd(), "public/symbol_rosa.svg"), "utf8")).replace(
    '<svg width="351px" height="473px"',
    '<svg width="351px" height="473px" viewBox="0 0 351 473"',
  );
  const mark = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  const font = (weight: 400 | 700) =>
    readFile(join(process.cwd(), `src/app/fonts/inter-latin-${weight}.woff`));
  const [regular, bold] = await Promise.all([font(400), font(700)]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 72,
        padding: "0 110px",
        background: "#18181b",
        color: "#ffffff",
        fontFamily: "Inter",
      }}
    >
      <img src={mark} width={234} height={315} alt="" />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 44, color: "#f280a1" }}>D-sektionen</div>
        <div style={{ fontSize: 104, fontWeight: 700, lineHeight: 1.05 }}>Ekonomi</div>
        <div style={{ fontSize: 34, color: "#a1a1aa", marginTop: 24 }}>
          Utlägg, budget och bokföring
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Inter", data: regular, weight: 400, style: "normal" },
        { name: "Inter", data: bold, weight: 700, style: "normal" },
      ],
    },
  );
}
