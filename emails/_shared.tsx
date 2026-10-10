// Sample data for the React Email preview server (`pnpm email:preview`).
//
// Every preview is drawn by the same code a sent mail is: the words and facts
// from lib/email/content.ts, the layout from lib/email/components.tsx. Only the
// data is made up, so what you see here is what a member gets. The logo comes
// from emails/static (a link to public/email-logo.png), since a preview has no
// attachment for the `cid:` address a sent mail uses.
import { EmailDocument } from "@/lib/email/components";
import { expenseNotice } from "@/lib/email/content";
import type { Email } from "@/lib/email/types";

export const LOGO = "/static/email-logo.png";

export const SAMPLE_EXPENSE = {
  id: "preview",
  reference: "DEK26-0043",
  title: "Kolsyra till pubben",
  grossAmount: 45000,
  purchaseDate: new Date("2026-10-08"),
  paymentType: "REIMBURSEMENT" as const,
  allocations: [{ costCenter: { code: "SEX01", name: "Sexmästeriet" } }],
};

export const SAMPLE_TRANSACTIONS = [
  { transactionDate: new Date("2026-10-02"), description: "ICA KVANTUM MALMBORGS", amount: -11790 },
  { transactionDate: new Date("2026-10-03"), description: "CLAS OHLSON 0421", amount: -43200 },
  { transactionDate: new Date("2026-10-06"), description: "Q*nelly.com", amount: 114400 },
  { transactionDate: new Date("2026-10-07"), description: "DOLLARSTORE LUND", amount: -4000 },
];

export function Preview({ email }: { email: Email }) {
  return <EmailDocument email={email} logoSrc={LOGO} />;
}

/** One of the mails about an utlägg, as `kind` words it. */
export function ExpensePreview({
  kind,
  comment,
}: {
  kind: Parameters<typeof expenseNotice>[0];
  comment?: string;
}) {
  return (
    <Preview
      email={expenseNotice(
        kind,
        SAMPLE_EXPENSE,
        {
          actor: "Maja Holm",
          submitter: "Ludwig Gehlsdorf",
          costCenter: "SEX01 – Sexmästeriet",
          days: 60,
        },
        comment ? { author: "Maja Holm", text: comment } : undefined,
      )}
    />
  );
}
