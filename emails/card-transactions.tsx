import { appUrl, emailT, frame, transactionsBlock } from "@/lib/email/content";
import { Preview, SAMPLE_TRANSACTIONS } from "./_shared";

// Built the way app/api/bank/import/route.ts builds it, for one holder.
export default function CardTransactions() {
  const cards = emailT("cardMask", { last4: "4821" });
  const count = SAMPLE_TRANSACTIONS.length;
  const url = appUrl("/bank?scope=mine");
  return (
    <Preview
      email={{
        subject: emailT("cardTransactions.subject", { count }),
        tone: "card",
        eyebrow: emailT("cardTransactions.eyebrow", { cards }),
        heading: emailT("cardTransactions.heading", { count }),
        intro: emailT("cardTransactions.intro"),
        blocks: [transactionsBlock(SAMPLE_TRANSACTIONS, 30)],
        action: { label: emailT("cardTransactions.button"), url },
        orOpen: emailT("orOpen", { url }),
        ...frame(emailT("reason.cardHolder", { cards })),
      }}
    />
  );
}
