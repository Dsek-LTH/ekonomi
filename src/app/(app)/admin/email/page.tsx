import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody } from "@/components/ui/card";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { EmailLog } from "./email-log";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("email");

export default async function AdminEmailPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.email");

  return (
    <PageShell title={t("title")} width="content">
      <Card>
        <CardBody>
          <EmailLog />
        </CardBody>
      </Card>
    </PageShell>
  );
}
