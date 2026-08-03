// Money is stored everywhere in the DB as an integer number of öre (1 SEK = 100
// öre) to avoid floating-point drift. The UI works in SEK. These are the single
// pair of converters — do not hand-roll `* 100` / `/ 100` elsewhere.

/** öre (integer) → SEK (decimal), for display/serialisation. */
export function oreToSEK(ore: number | null | undefined): number {
  return (ore ?? 0) / 100;
}

/** SEK (decimal, possibly from user input) → öre (integer), rounded. */
export function sekToOre(sek: number | null | undefined): number {
  return Math.round((sek ?? 0) * 100);
}

/** Parse a user-entered amount string ("1 234,50" / "1234.5") into SEK. */
export function parseSEK(input: string): number {
  const normalised = input.replace(/\s/g, "").replace(",", ".");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a user-entered amount string straight into öre (integer). */
export function parseOre(input: string): number {
  return sekToOre(parseSEK(input));
}
