// A milersättning, as arithmetic.
//
// One journey per claim, described by the odometer at each end: what the car
// said when it was got into, and what it said when it was got out of. The
// distance is the difference and the money is the distance at the rate in force
// on the day. Neither is ever typed, which is the point. A distance is a number
// somebody arrived at; two readings are a statement about what a dashboard
// showed, and an attester can ask to see it.
//
// Pure over plain data, so the form totalling what is being typed and the route
// valuing what it is about to store run the same code and cannot disagree about
// what a claim comes to.
//
// Somebody who drove three times files three claims. That is not a limitation
// dressed as a decision: each journey is attested on its own and lands on its
// own cost centre, which a sheet of journeys sharing one amount could not do.
import { isCompleteDate } from "@/lib/domain/date";
import { rateOn, distanceOre, type MileageRateLike } from "./rate";

/** A journey as somebody typed it. */
export interface JourneyInput {
  /** ISO date. Half-typed ("2026-08") counts as missing, not as a day. */
  date: string;
  /**
   * The total odometer when the journey started and when it ended, in
   * kilometres. The car's lifetime reading, not the trip meter: see the
   * columns behind these on the Expense model.
   *
   * Null for a reading not yet given: a draft is allowed to be half-filled,
   * and 0 is a real reading (a car straight off the lot) rather than a way of
   * saying "blank".
   */
  odometerStart: number | null;
  odometerEnd: number | null;
  /**
   * Every place the car stopped, in the order it stopped there, as free text.
   *
   * The first is where the journey began and the last is where it ended; the
   * ones between are what was visited on the way. A round trip is a list whose
   * last stop repeats its first, which is why nothing here flags one.
   *
   * May be short or blank while a draft is being filled in. Two stops that say
   * something are required to send, because the distance alone does not say the
   * driving was the section's errand, which is what the whole claim rests on.
   */
  stops: string[];
}

/** The stops that actually name a place, in order. Blank rows are what an
 *  editor leaves behind when somebody clears one, and they are not places. */
export function namedStops(stops: string[]): string[] {
  return stops.map((s) => s.trim()).filter((s) => s !== "");
}

interface ValuedJourney {
  /** The distance driven, or null while the two readings do not give one. */
  km: number | null;
  /** Öre per kilometre on the journey's date, or null where none applies. */
  orePerKm: number | null;
  /** What the journey is worth in öre, or null where it cannot be valued. */
  ore: number | null;
}

/**
 * The distance between two readings, or null when they do not describe a
 * journey.
 *
 * A journey goes forward. Equal readings are somebody who has not driven yet,
 * and a smaller end reading is a mistyped digit or the two fields the wrong way
 * round. Neither is a distance, and neither should quietly become one by
 * taking an absolute value.
 *
 * Rounded to the tenth the readings are kept at, so 12345.6 − 12300.1 is 45.5
 * and not 45.499999999998.
 */
export function journeyKm(start: number | null, end: number | null): number | null {
  if (start == null || end == null) return null;
  const km = Math.round((end - start) * 10) / 10;
  return km > 0 ? km : null;
}

/**
 * Value a journey: the distance, the day's rate, and what it comes to.
 *
 * Takes only the three fields it actually reads, rather than a whole
 * `JourneyInput`. What a journey is worth has nothing to do with where it went,
 * and saying so in the signature means the route valuing a claim need not hand
 * over a route it would ignore.
 */
export function valueJourney(
  journey: Pick<JourneyInput, "date" | "odometerStart" | "odometerEnd">,
  rates: MileageRateLike[],
): ValuedJourney {
  const km = journeyKm(journey.odometerStart, journey.odometerEnd);
  const rate = isCompleteDate(journey.date) ? rateOn(rates, journey.date) : null;
  return {
    km,
    orePerKm: rate?.orePerKm ?? null,
    ore: km != null && rate ? distanceOre(km, rate.orePerKm) : null,
  };
}

/**
 * Why a milersättning cannot be sent yet, or null when it can.
 *
 * The mileage half of `submitBlocker` (lib/domain/status.ts), kept here because
 * it is about the journey rather than about the utlägg around it, and because
 * the form needs the same answer while it is being typed, before anything has
 * been saved. Each value names a message under `mileage.blocker.<it>`.
 *
 * The date is not checked here. Every utlägg has one and `submitBlocker`
 * already refuses a missing or future one; saying it twice would mean two
 * places to keep in step and two different sentences for one mistake.
 *
 * Ordered the way the form is filled in, so the sentence shown is about the
 * field somebody is nearest: the stops, then the readings, then whether they
 * make a journey, then whether the day can be priced.
 *
 * Two stops is the floor, not a shape: a journey that went one place and came
 * back is written as that place twice, and one that visited four is written as
 * four. What is refused is a claim naming one place or none, which states a
 * distance nobody can put anywhere.
 */
type MileageBlocker = "noRoute" | "noReadings" | "notForward" | "noRate";

export function claimBlocker(
  journey: JourneyInput,
  rates: MileageRateLike[],
): MileageBlocker | null {
  if (namedStops(journey.stops).length < 2) return "noRoute";
  if (journey.odometerStart == null || journey.odometerEnd == null) return "noReadings";
  if (journeyKm(journey.odometerStart, journey.odometerEnd) == null) return "notForward";
  if (!isCompleteDate(journey.date) || !rateOn(rates, journey.date)) return "noRate";
  return null;
}
