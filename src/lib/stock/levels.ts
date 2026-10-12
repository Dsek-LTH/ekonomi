// Open bottles, and the four levels the bar judges them at.
//
// Nothing is measured. Somebody picks a bottle up, looks at it, and calls it
// four fifths, three fifths, two fifths, one fifth, and that estimate is the
// only fact there is about how much is in it. Carrying millilitres would be
// stating a precision nobody has; carrying a level says exactly what was known.
//
// Two rules follow, and both are the bar's rather than ours:
//
// A level is set on the way *in* and never on the way out. Coming back from a
// pub is when a bottle is looked at, so that is when it lands on a rung. Taking
// one out is picking one that is already there, which is why nothing here can
// re-estimate a bottle at the moment it leaves.
//
// And a return says only what came back. Not what it *was*. That is not a fact
// about the shelf, the checkout already recorded it by taking the bottle off,
// and asking for it again is asking two questions that can contradict each
// other. What a return is checked against is the count that is out.
//
// And the open ones go first. A sealed bottle cannot leave the store while an
// open one of the same product is sitting in it, or the shelf fills with
// quarter-full bottles nobody will ever choose over a fresh one.

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

/**
 * What the open bottles hold, in millilitres.
 *
 * An estimate built out of estimates, and only ever used for the litres on a
 * screen, never for what the stock is worth, which counts sealed bottles
 * alone. A bottle called "40 %" is somewhere near 40 % and the total inherits
 * every one of those roundings.
 */
export const openMl = (open: OpenBottles, nominalMl: number): number =>
  LEVELS.reduce((sum, l) => sum + (bottlesAt(open, l) * l * nominalMl) / 100, 0);

/**
 * Why these bottles cannot be taken out. Each is a message key under
 * `errors.stock`, so the form and the route say the same sentence.
 */
type PickFault = "openBottlesFirst" | "notThatManyOpen" | "notThatManySealed";

/** What somebody is taking out: some open bottles, and some sealed ones. */
export interface Pick {
  sealed: number;
  open: OpenBottles;
}

/**
 * Whether the store holds these bottles at all.
 *
 * Availability and nothing else, which is the whole of the rule wherever
 * nobody is choosing. A bottle broken in the cellar is the bottle that broke:
 * it may have been the sealed one standing next to a 20 % one, and a rule that
 * refused to record that would be asking somebody to write down a different
 * accident from the one that happened. See `pickFault` for taking stock out to
 * a pub, which is a choice, and where the ladder does have a say.
 */
export function shortfall(stock: BottleStock, pick: Pick): PickFault | null {
  for (const level of LEVELS) {
    if (bottlesAt(pick.open, level) > bottlesAt(stock.open, level)) return "notThatManyOpen";
  }
  return pick.sealed > stock.sealed ? "notThatManySealed" : null;
}

/**
 * Whether this is a set of bottles the store can actually give up.
 *
 * The interesting rule is the last one. Sealed bottles are refused while any
 * open bottle of the product remains behind, *behind*, not merely in stock, so
 * taking the last two open ones along with a sealed one is fine and taking a
 * sealed one while a 20 % bottle stays on the shelf is not. That is the point:
 * the dregs leave with you, or the fresh bottle stays.
 */
export function pickFault(stock: BottleStock, pick: Pick): PickFault | null {
  const missing = shortfall(stock, pick);
  if (missing) return missing;
  if (pick.sealed > 0 && openCount(stock.open) > openCount(pick.open)) {
    return "openBottlesFirst";
  }
  return null;
}

