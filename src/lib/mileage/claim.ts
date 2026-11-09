// A milersättning as arithmetic: one journey per claim, from the odometer at each end. Distance is the
// difference, money is distance at the rate on the day; neither is typed. Pure, so the form and the route agree.
// Several drives are several claims, each attested on its own cost centre.
import { isCompleteDate } from "@/lib/domain/date";
import { rateOn, distanceOre, type MileageRateLike } from "./rate";

/** A journey as somebody typed it. */
export interface JourneyInput {
  /** ISO date. Half-typed ("2026-08") counts as missing, not as a day. */
  date: string;
  /** Total odometer (not the trip meter) in km at start and end. Null when not yet given; 0 is a real reading. */
  odometerStart: number | null;
  odometerEnd: number | null;
  /**
   * Every place the car stopped, in order, as free text. A round trip repeats its first stop. May be short while a
   * draft; two named stops are required to send, since only they say the driving was the section's errand.
   */
  stops: string[];
}

/** The stops that actually name a place, in order (blank rows are what an editor leaves behind). */
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
 * The distance between two readings, or null when they do not describe a journey. Equal or reversed readings are
 * not distances. Rounded to the tenth the readings are kept at, so 12345.6 - 12300.1 is 45.5.
 */
export function journeyKm(start: number | null, end: number | null): number | null {
  if (start == null || end == null) return null;
  const km = Math.round((end - start) * 10) / 10;
  return km > 0 ? km : null;
}

/** Value a journey: the distance, the day's rate and what it comes to. Takes only the three fields it reads. */
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
 * Why a milersättning cannot be sent yet, or null when it can. The mileage half of `submitBlocker`
 * (lib/domain/status.ts), usable while the form is typed. Names a message under `mileage.blocker.<it>`.
 * The date is not checked here (`submitBlocker` does). Ordered as the form is filled in. Two stops is the
 * floor: a round trip is that place twice.
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
