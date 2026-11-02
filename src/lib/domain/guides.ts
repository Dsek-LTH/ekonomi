// The guides: one short tour per page, pointing at the page's real controls
// and saying what each is for. See docs/guides.md.
//
// Data only. The engine that walks them is components/shell/guide.tsx, and the
// words are under `guides.<id>.<key>` in messages/. A step's `target` is the
// `data-tour` attribute it points at, and guides.test.ts checks every one of
// them is somewhere in src/.
//
// Each step is shown once to each reader, and remembered by its id
// (`<guide>.<key>`) on User.seenGuideSteps. Most steps need no rule for who
// they are for: they point at a control, and the app only draws a control for
// whoever may use it. So a reader who is later given more sees only the steps
// for what is new, the next time they open the page.
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
  /** Its title and body, under `guides.<id>.<key>`, and its id with the guide's. */
  key: string;
  /**
   * The `data-tour` it points at. None is a card in the middle of the screen.
   * A step whose target is not drawn for this reader is not theirs, and is
   * left out until it is.
   */
  target?: string;
  /** Shown in the middle instead of left out when the target is not there. */
  orCentre?: boolean;
  /** Who the step is for, where the target cannot say (a card in the middle). */
  visible?: (user: CurrentUser) => boolean;
  /**
   * What the guide holds open while the step shows: the nav, or the account
   * menu for theme and language. On a phone both are the one menu screen.
   */
  opens?: "nav" | "account";
}

export interface Guide {
  id: GuideId;
  /** The page it belongs to, and starts on by itself. */
  page: string;
  steps: GuideStep[];
}

const unitHolder = (u: CurrentUser) => u.roles.includes("RESULTATANSVARIG");

export const GUIDES: Guide[] = [
  {
    // Every page the reader can reach, once over lightly, and the switches
    // worth knowing about from the first day. The pages explain themselves
    // with their own guides.
    id: "start",
    page: "/dashboard",
    steps: [
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
      // The header's Frågor & svar from md. A phone has no header, and the
      // word is still worth saying.
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
      // A resultatansvarig alone has one tab, and with one tab there is no tab
      // bar to point at.
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
    page: "/income",
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

/** Every step's id, for the route that records them. */
export const GUIDE_STEP_IDS = GUIDES.flatMap((g) => g.steps.map((s) => guideStepId(g, s)));
