// Open bottles and the four levels the bar judges them at (an eyeballed estimate, so no millilitres).
// A level is set on the way in, never out. A return says only what came back. Open bottles go first.

/** The rungs, highest first, which is also the order they are used up in. */
export const LEVELS = [80, 60, 40, 20] as const;
export type Level = (typeof LEVELS)[number];

export const isLevel = (n: number): n is Level => (LEVELS as readonly number[]).includes(n);

/** How many open bottles stand at each level. Missing is none. */
export type OpenBottles = Partial<Record<Level, number>>;

/** The whole shelf for one product: what is sealed, and what is open. */
export interface BottleStock {
  sealed: number;
  open: OpenBottles;
}

export const bottlesAt = (open: OpenBottles, level: Level): number => open[level] ?? 0;

/** How many bottles are open, at any level. */
export const openCount = (open: OpenBottles): number =>
  LEVELS.reduce((sum, l) => sum + bottlesAt(open, l), 0);

/** Open bottles in millilitres. An estimate, for display only, never for valuation. */
export const openMl = (open: OpenBottles, nominalMl: number): number =>
  LEVELS.reduce((sum, l) => sum + (bottlesAt(open, l) * l * nominalMl) / 100, 0);

/** Each is a message key under `errors.stock`. */
type PickFault = "openBottlesFirst" | "notThatManyOpen" | "notThatManySealed";

/** What somebody is taking out: some open bottles, and some sealed ones. */
export interface Pick {
  sealed: number;
  open: OpenBottles;
}

/** Availability only, for wherever nobody is choosing (a broken bottle is the bottle that broke). See `pickFault`. */
export function shortfall(stock: BottleStock, pick: Pick): PickFault | null {
  for (const level of LEVELS) {
    if (bottlesAt(pick.open, level) > bottlesAt(stock.open, level)) return "notThatManyOpen";
  }
  return pick.sealed > stock.sealed ? "notThatManySealed" : null;
}

/** Availability plus the bar's rule: a sealed bottle may not leave while an open one stays behind. */
export function pickFault(stock: BottleStock, pick: Pick): PickFault | null {
  const missing = shortfall(stock, pick);
  if (missing) return missing;
  if (pick.sealed > 0 && openCount(stock.open) > openCount(pick.open)) {
    return "openBottlesFirst";
  }
  return null;
}

/** A row's effect on the open bottles, as "80 % → 40 %" or "+ 60 %". */
export function levelSummary(open: Record<number, number>): string {
  const left = LEVELS.filter((l) => (open[l] ?? 0) < 0);
  const arrived = LEVELS.filter((l) => (open[l] ?? 0) > 0);
  const part = (levels: number[]) =>
    levels
      .map((l) => `${Math.abs(open[l] ?? 0) > 1 ? `${Math.abs(open[l] ?? 0)}×` : ""}${l} %`)
      .join(", ");
  if (left.length && arrived.length) return `${part(left)} → ${part(arrived)}`;
  if (left.length) return `− ${part(left)}`;
  if (arrived.length) return `+ ${part(arrived)}`;
  return "";
}
