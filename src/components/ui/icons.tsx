// Minimal stroke icons (currentColor, 1.6px), no icon dependency.
type P = { className?: string };
const base = "size-[18px]";

function Svg({ className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? base}
    >
      {children}
    </svg>
  );
}

export const IconGrid = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);

// The two shapes a list can be drawn in, for the view toggle
// (components/ui/view-toggle.tsx). Pictures of the layouts themselves: a
// master–detail split and a table, because the toggle carries no words.
export const IconViewSplit = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9.5 4v16" />
  </Svg>
);

export const IconViewTable = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9.5h18M3 15h18" />
  </Svg>
);

export const IconReceipt = (p: P) => (
  <Svg {...p}>
    <path d="M6 3h12v18l-2-1.2L14 21l-2-1.2L10 21l-2-1.2L6 21V3Z" />
    <path d="M9 8h6M9 12h6" />
  </Svg>
);

export const IconCard = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 9.5h19M6 15h4" />
  </Svg>
);

// Eget utlägg: one person, whose own money it was.
//
// A wallet and a banknote were both tried first and both are a rounded
// rectangle, which at 18px is the card above with the details rubbed off. That
// is the wrong failure: the icon is what carries this when the colour cannot
// (a printed page, a reader who sees no hue), so its silhouette has to differ
// from the other two before its detail does. A head and shoulders, a
// rectangle and a car share no outline at any size.
export const IconPerson = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Svg>
);

// Milersättning, the settings screen for it, and nothing else so far. A car
// from the side: the bonnet line, the body, and the two wheels sitting on it.
export const IconCar = (p: P) => (
  <Svg {...p}>
    <path d="M4 16.5v-4l1.8-4.2A2 2 0 0 1 7.6 7h8.8a2 2 0 0 1 1.8 1.3L20 12.5v4" />
    <path d="M4 12.5h16" />
    <circle cx="7.5" cy="16.5" r="1.6" />
    <circle cx="16.5" cy="16.5" r="1.6" />
  </Svg>
);

export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const IconMenu = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
);

export const IconUndo = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h11a5 5 0 0 1 0 10H8" />
    <path d="m8 4-4 4 4 4" />
  </Svg>
);

// Two arcs chasing each other round a circle, pull from Fortnox, again. The
// arcs stop at 140° each so the gaps stay open at 18px; the arrowheads sit
// astride the stroke rather than capping it, which is what keeps this from
// reading as a plain ring. Spin it (`animate-spin`) while a sync is running.
export const IconSync = (p: P) => (
  <Svg {...p}>
    <path d="M4.48 9.26A8 8 0 0 1 19.52 9.26" />
    <path d="M16.93 7.11 19.52 9.26 20.13 5.95" />
    <path d="M19.52 14.74A8 8 0 0 1 4.48 14.74" />
    <path d="M7.07 16.89 4.48 14.74 3.87 18.05" />
  </Svg>
);

export const IconBook = (p: P) => (
  <Svg {...p}>
    <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5Z" />
    <path d="M4 19a2 2 0 0 0 2 2h12" />
  </Svg>
);

// Income: a coin with an arrow coming in. The counterpart to IconReceipt,
// which is money going the other way.
export const IconIncome = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="14" r="7" />
    <path d="M12 11v6M10 12.5h3a1.5 1.5 0 0 1 0 3h-2a1.5 1.5 0 0 0 0 3h3" />
    <path d="M12 6V2M9.5 4.5 12 2l2.5 2.5" />
  </Svg>
);

// A crate of bottles: the stock, and the one thing in the nav that is a
// physical object rather than a document.
export const IconBox = (p: P) => (
  <Svg {...p}>
    <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
    <path d="M3 7.5 12 12l9-4.5M12 12v9" />
  </Svg>
);

// A barcode between the corners of a viewfinder. The scanning control, whether
// or not there is a camera behind it. The same button also takes a code typed
// in, or fired at the field by a handheld reader.
export const IconScan = (p: P) => (
  <Svg {...p}>
    <path d="M3 8V5.5A1.5 1.5 0 0 1 4.5 4H7M17 4h2.5A1.5 1.5 0 0 1 21 5.5V8M21 16v2.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H4.5A1.5 1.5 0 0 1 3 18.5V16" />
    <path d="M7.5 8.5v7M11 8.5v7M14.5 8.5v7M17.5 8.5v7" />
  </Svg>
);

// Switching between the cameras a machine has: the lens, and the turn that puts
// the other one behind it. Drawn as a lens rather than a camera body because at
// 18px a body with arrows inside it is a smudge, and the arrows need the room.
export const IconCameraFlip = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 4a8 8 0 0 1 8 8" />
    <path d="M18.9 10.5 20 12l1.1-1.5" />
    <path d="M12 20a8 8 0 0 1-8-8" />
    <path d="M5.1 13.5 4 12l-1.1 1.5" />
  </Svg>
);

// An event: a night with a date, which is the only thing that identifies
// one. The dot is the day it is.
export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M4 10h16M8 3v4M16 3v4M12 14.5h.01" />
  </Svg>
);

// The log: rows in date order, which is all it ever is.
export const IconList = (p: P) => (
  <Svg {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Svg>
);

// A sheet with a signature on it: the avtal archive, and the one icon in the
// set that has to say "document somebody put their name to" rather than merely
// "document". The squiggle is what distinguishes it from IconList.
export const IconContract = (p: P) => (
  <Svg {...p}>
    <path d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M13 3v5h5" />
    <path d="M8.5 17c1-1.5 1.8-2.2 2.4-2.1.7.1.3 1.8 1 2 .6.2 1.2-.7 3.6-.9" />
  </Svg>
);

export const IconGear = (p: P) => (
  <Svg {...p}>
    <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.43.992.004.085.004.17 0 .255-.008.378.137.75.43.991l1.004.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.49l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.93 6.93 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IconUpload = (p: P) => (
  <Svg {...p}>
    <path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14" />
  </Svg>
);

// An elbow: down out of the line above, then right into this one. It says that
// a row belongs to the thing over it: a product's variant stepped in under its
// name, a budget line under its account number. A drawing of \variantpil in
// intakt/assets/intakt.tex, so the sold-lines table and the intäktsräkning
// beside it mark a grouped row the same way.
export const IconElbow = (p: P) => (
  <Svg {...p}>
    <path d="M8 5v9h9m-3-3 3 3-3 3" />
  </Svg>
);

// The mirror of IconUpload: bringing something in rather than sending it out,
// a period fetched from Zettle or Swish.
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14" />
  </Svg>
);

export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07L10.5 5.5" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-2 2a5 5 0 0 0 7.07 7.07L13.5 18.5" />
  </Svg>
);

// A link that leaves the app. The arrow out of the box, which is the one mark
// people already read as "this opens somewhere else".
export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M14 5h5v5" />
    <path d="M19 5l-7 7" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
);

export const IconChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const IconChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.35-4.35" />
  </Svg>
);

// Sliders rather than a funnel. A funnel says "narrow this down", which is the
// same thing, but the sliders say it while also looking adjustable, and this
// one opens a sheet you set things in rather than applying anything itself.
export const IconFilter = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
    <circle cx="9" cy="7" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Svg>
);

// The overflow mark: what a menu of "everything else" is called when there is
// no room to call it anything.
export const IconDots = (p: P) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </Svg>
);

// Swapping one thing for another, the stock sheet's "byt produkt". Two arrows
// passing, rather than a circular refresh: nothing here is being reloaded, one
// row is becoming a different product.
export const IconSwap = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h13l-3.2-3.2M20 16H7l3.2 3.2" />
  </Svg>
);

export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </Svg>
);

export const IconPencil = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h4L20 8l-4-4L4 16v4Z" />
    <path d="m14.5 5.5 4 4" />
  </Svg>
);

// Two sheets, the back one offset, the copy action.
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
  </Svg>
);

// Shackle down, closed: the state "locked", and the action "lock this".
export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="10.5" width="16" height="10.5" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </Svg>
);

// The same body, but the shackle has swung free: it keeps only its left leg and
// the loop tilts up and away to the right, ending clear of the body. A shackle
// that merely stops short reads as the closed one at 18px. The whole silhouette
// has to differ, not one leg's length.
export const IconLockOpen = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="10.5" width="16" height="10.5" rx="2" />
    <path d="M8 10.5V6.5a4 4 0 0 1 7.8-1.2" />
  </Svg>
);

// A shield, for Roller & behörigheter. Not a lock: a lock is a state something
// is in (a budget is locked, a voucher is not) and this is standing authority
// rather than a thing that has been shut. The tick inside says the same as the
// grid the page is mostly made of.
export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.3-3 8.2-7.5 9.5-4.5-1.3-7.5-5.2-7.5-9.5V6L12 3Z" />
    <path d="m9 11.8 2.1 2.1L15 10" />
  </Svg>
);

export const IconComment = (p: P) => (
  <Svg {...p}>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10Z" />
  </Svg>
);

export const IconChart = (p: P) => (
  <Svg {...p}>
    <path d="M3 3v18h18M7 16v-4M11 16V8M15 16v-7M19 16v-2" />
  </Svg>
);

// A sheet ruled into a header row and a figures column: the budget is the plan
// you fill in, where IconChart is the outcome that came out of it.
export const IconBudget = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M4 9h16M14 9v12" />
  </Svg>
);

// Two bars of different heights on one baseline: the same measure taken twice.
// IconChart is a series over time; this is one thing held against another.
export const IconCompare = (p: P) => (
  <Svg {...p}>
    <path d="M3 21h18" />
    <rect x="5" y="9" width="5.5" height="12" rx="1.5" />
    <rect x="13.5" y="4" width="5.5" height="17" rx="1.5" />
  </Svg>
);

export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 9v5M12 17.5v.5" />
  </Svg>
);

export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.5" />
  </Svg>
);

export const IconHelp = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1v.5M12 16.5v.5" />
  </Svg>
);

export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Svg>
);

// A second figure standing behind the first: a list of people, where
// IconPerson is one of them.
export const IconUsers = (p: P) => (
  <Svg {...p}>
    <circle cx="9.5" cy="8" r="3.4" />
    <path d="M3 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.9a3.4 3.4 0 0 1 0 6.2" />
    <path d="M17.5 14a6.5 6.5 0 0 1 3.5 5.4" />
  </Svg>
);

// One node with two branching under it: a result unit is the parent its cost
// centres hang off, matched by code prefix.
export const IconHierarchy = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="5" rx="1.5" />
    <rect x="3" y="16" width="6" height="5" rx="1.5" />
    <rect x="15" y="16" width="6" height="5" rx="1.5" />
    <path d="M12 8v6M6 16v-2h12v2" />
  </Svg>
);

// Filled flag icons (not stroke-based), drawn 3:2 with `slice` so they fill a
// square/circular frame without distortion. Used by the language switcher.
export const FlagSE = ({ className }: P) => (
  <svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
    <rect width="30" height="20" fill="#006AA7" />
    <rect x="9" width="4" height="20" fill="#FECC00" />
    <rect y="8" width="30" height="4" fill="#FECC00" />
  </svg>
);

export const FlagGB = ({ className }: P) => (
  <svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
    <clipPath id="flag-gb"><rect width="30" height="20" /></clipPath>
    <g clipPath="url(#flag-gb)">
      <rect width="30" height="20" fill="#012169" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#fff" strokeWidth="4" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#C8102E" strokeWidth="2.4" />
      <path d="M15,0 V20 M0,10 H30" stroke="#fff" strokeWidth="6" />
      <path d="M15,0 V20 M0,10 H30" stroke="#C8102E" strokeWidth="3.6" />
    </g>
  </svg>
);
