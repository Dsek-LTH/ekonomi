import { notFound } from "next/navigation";

import { getEmailBody, getEmailRow } from "@/lib/data/emails";
import { canAccessSettings } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";
import { EmailClient } from "./email-client";

export const generateMetadata = titled("email");

export default async function AdminEmailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage(canAccessSettings);
  const { id } = await params;
  const [row, body] = await Promise.all([getEmailRow(id), getEmailBody(id)]);
  if (!row || !body) notFound();

  return <EmailClient key={row.id} row={row} body={body} />;
}
