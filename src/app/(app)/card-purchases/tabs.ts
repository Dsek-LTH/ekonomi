// The tab /card-purchases opens on. Declared here rather than in
// card-purchases-client.tsx for the reason spelled out in the approvals page's
// tabs.ts: a Server Component cannot import a value from a "use client" module,
// and this one is read by both halves.
export const CARD_PURCHASES_DEFAULT_TAB = "UNMATCHED";
