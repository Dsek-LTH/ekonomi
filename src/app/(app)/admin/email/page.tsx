import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody } from "@/components/ui/card";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { EmailLog } from "./email-log";

// Inställningar → E-post: every mail the app has sent, to whom, and what
// became of it. A test mail is sent from a member's own dialog under
// Användare, where the log narrows to them. See ./email-log.tsx.
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
