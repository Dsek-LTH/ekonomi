import { access } from "node:fs/promises";
import path from "node:path";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/request";
import { loadFaq, type FaqBlock, type FaqSection } from "./faq-content";
import { FaqClient } from "./faq-client";

// Where the example photos go, and what they may be called. The content names a
// basename only (`valid-store`), so replacing a JPG with a PNG, or adding the
// photo for an example that hasn't got one yet, is dropping a file in this
// directory and nothing else. The page renders per request (the app layout is
// force-dynamic), so a new file shows up on the next load without a deploy.
const RECEIPT_DIR = "faq/receipts";
const EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif"];

async function findPhoto(file: string): Promise<string | null> {
  for (const ext of EXTENSIONS) {
    const rel = `${RECEIPT_DIR}/${file}.${ext}`;
    try {
      await access(path.join(process.cwd(), "public", rel));
      return `/${rel}`;
    } catch {
      // Not this extension; try the next.
    }
  }
  return null;
}

async function resolveBlock(block: FaqBlock): Promise<FaqBlock> {
  if (block.t !== "image") return block;
  return {
    ...block,
    src: await findPhoto(block.file),
    expected: `public/${RECEIPT_DIR}/${block.file}.jpg`,
  };
}

export default async function FaqPage() {
  const locale = (await getLocale()) as Locale;
  const sections = await loadFaq(locale);

  // Only the two example sections carry image blocks, but resolving over the
  // whole tree means an illustration can be dropped into any answer later
  // without this file having to learn about it.
  const resolved: FaqSection[] = await Promise.all(
    sections.map(async (section) => ({
      ...section,
      items: await Promise.all(
        section.items.map(async (item) => ({
          ...item,
          a: await Promise.all(item.a.map(resolveBlock)),
        })),
      ),
    })),
  );

  return <FaqClient sections={resolved} />;
}
