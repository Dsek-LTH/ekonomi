import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody } from "@/components/ui/card";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getInboxHealth } from "@/lib/data/supplier-invoices";
import { EmailLog } from "./email-log";
import { MailboxCard } from "./mailbox-card";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("email");

export default async function AdminEmailPage() {
  await requirePage(canAccessSettings);
  const [t, health] = await Promise.all([getTranslations("admin.email"), getInboxHealth()]);

  return (
    <PageShell title={t("title")} width="content">
      <MailboxCard health={health} />
      <Card>
        <CardBody>
          <EmailLog />
        </CardBody>
      </Card>
    </PageShell>
  );
}
