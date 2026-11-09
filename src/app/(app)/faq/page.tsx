import { access } from "node:fs/promises";
import path from "node:path";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/request";
import { loadFaq, type FaqBlock, type FaqSection } from "./faq-content";
import { FaqClient } from "./faq-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("faq");

// Example photos: the content names a basename only, so any extension in this directory works.
const RECEIPT_DIR = "faq/receipts";
const EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif"];

async function findPhoto(file: string): Promise<string | null> {
  for (const ext of EXTENSIONS) {
    const rel = `${RECEIPT_DIR}/${file}.${ext}`;
    try {
      await access(path.join(process.cwd(), "public", rel));
      return `/${rel}`;
    } catch {}
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
