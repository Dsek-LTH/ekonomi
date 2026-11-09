// The guides: one short tour per page. Data only: the engine is components/shell/guide.tsx, the words
// are `guides.<id>.<key>` in messages/, and a step's `target` is a `data-tour` attribute (guides.test.ts
// checks each exists in src/). Steps are shown once per reader, remembered by id on User.seenGuideSteps.
// See docs/guides.md.
import type { CurrentUser } from "./types";

export const GUIDE_IDS = [
  "start",
  "expenses",
  "bank",
  "inbox",
  "invoices",
  "income",
  "budget",
  "ledger",
  "stock",
] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export interface GuideStep {
  key: string;
  /** The `data-tour` it points at. None is a card in the middle. A step whose target is not drawn for this reader is left out. */
  target?: string;
  orCentre?: boolean;
  visible?: (user: CurrentUser) => boolean;
  /** What the guide holds open while the step shows: the nav, or the account menu. On a phone both are the one menu screen. */
  opens?: "nav" | "account";
  /** Only on a device that can still install the app (a phone in its browser, components/pwa/platform.ts). Not marked seen when skipped. */
  device?: "installable";
  content?: "install";
}

export interface Guide {
  id: GuideId;
  page: string;
  steps: GuideStep[];
}

const unitHolder = (u: CurrentUser) => u.roles.includes("RESULTATANSVARIG");

export const GUIDES: Guide[] = [
  {
    id: "start",
    page: "/dashboard",
    steps: [
      { key: "install", device: "installable", content: "install" },
      { key: "welcome" },
      { key: "todo", target: "todo" },
      { key: "groupExpenses", target: "nav-group:groupExpenses", opens: "nav" },
      { key: "groupInvoices", target: "nav-group:groupInvoices", opens: "nav" },
      { key: "groupBookkeeping", target: "nav-group:groupBookkeeping", opens: "nav" },
      { key: "groupBudget", target: "nav-group:groupBudget", opens: "nav" },
      { key: "groupStock", target: "nav-group:groupStock", opens: "nav" },
      { key: "groupRental", target: "nav-group:groupRental", opens: "nav" },
      { key: "groupAdmin", target: "nav-group:groupAdmin", opens: "nav" },
      { key: "settings", target: "nav-settings", opens: "nav" },
      { key: "year", target: "fiscal-year" },
      // The header's Frågor & svar from md. A phone has no header.
      { key: "help", target: "faq", orCentre: true },
      { key: "theme", target: "theme", opens: "account" },
      { key: "language", target: "language", opens: "account" },
    ],
  },
  {
    id: "expenses",
    page: "/expenses",
    steps: [
      { key: "intro" },
      { key: "new", target: "list-action" },
      { key: "stages", target: "stage-tabs" },
      { key: "scopeMine", target: "scope:mine" },
      { key: "scopeUnit", target: "scope:unit" },
      { key: "scopeAll", target: "scope:all" },
    ],
  },
  {
    id: "bank",
    page: "/bank",
    steps: [
      { key: "intro" },
      { key: "unaccounted", target: "tab:unaccounted" },
      { key: "scopeMine", target: "scope:mine" },
      { key: "scopeUnit", target: "scope:unit" },
      { key: "scopeAll", target: "scope:all" },
      { key: "import", target: "list-action" },
    ],
  },
  {
    id: "inbox",
    page: "/invoices/inbox",
    steps: [
      { key: "intro" },
      // A resultatansvarig alone has one tab, so there is no tab bar to point at.
      { key: "unit", visible: unitHolder },
      { key: "sort", target: "tab:sort" },
      { key: "units", target: "tab:units" },
      { key: "upload", target: "list-action" },
    ],
  },
  {
    id: "invoices",
    page: "/invoices",
    steps: [
      { key: "intro" },
      { key: "stages", target: "stage-tabs" },
      { key: "scopeUnit", target: "scope:unit" },
      { key: "scopeAll", target: "scope:all" },
    ],
  },
  {
    id: "income",
    page: "/income/zettle",
    steps: [
      { key: "intro" },
      { key: "actions", target: "list-action" },
      { key: "stages", target: "stage-tabs" },
    ],
  },
  {
    id: "budget",
    page: "/budget",
    steps: [
      { key: "intro" },
      { key: "compare", target: "budget-compare" },
      { key: "new", target: "budget-new" },
    ],
  },
  {
    id: "ledger",
    page: "/ledger",
    steps: [
      { key: "intro" },
      { key: "params", target: "ledger-params" },
      { key: "tools", target: "ledger-tools" },
    ],
  },
  {
    id: "stock",
    page: "/stock",
    steps: [
      { key: "intro" },
      { key: "sections", target: "section-tabs" },
      { key: "attention", target: "tab:ATTENTION" },
      { key: "manage", target: "list-action" },
    ],
  },
];

export const guideStepId = (guide: Guide, step: GuideStep) => `${guide.id}.${step.key}`;

export const GUIDE_STEP_IDS = GUIDES.flatMap((g) => g.steps.map((s) => guideStepId(g, s)));
