import { digestEmail } from "@/lib/email/content";
import { Preview, SAMPLE_TRANSACTIONS } from "./_shared";

export default function WeeklyDigest() {
  return (
    <Preview
      email={digestEmail("Maja Holm", "2026-W41", {
        unmatched: SAMPLE_TRANSACTIONS.slice(1, 3),
        deadline: [
          { title: "Tågbiljetter till SM-veckan", sub: "Utkast, köpt 2026-08-17", pill: "6 dagar kvar" },
        ],
        attest: [
          {
            title: "DEK26-0043 – Kolsyra till pubben",
            sub: "Från Ludwig Gehlsdorf, väntat i 5 dagar",
            amount: "450,00 kr",
          },
          {
            title: "DEK26-0047 – Dekor till sittningen",
            sub: "Från Elsa Lindqvist, väntat i 2 dagar",
            amount: "980,00 kr",
          },
        ],
      })}
    />
  );
}
