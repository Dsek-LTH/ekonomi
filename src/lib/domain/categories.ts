// The drink types, in the order every screen lists them.
//
// It lived on the product dialog, which was fine while a form and a filter were
// the only things that needed it. The order is a decision about reading rather
// than about that form (what the cellar carries most of first, the rarities
// last) and a chart stacks its bands in it too, so it belongs where anything
// can reach it without importing a dialog.
import type { DrinkCategory } from "./types";

export const CATEGORIES: DrinkCategory[] = [
  "OL",
  "OVRIG_JASTDRYCK",
  "VIN",
  "SPRITDRYCK",
  "ALKOHOLDRYCKSLIKNANDE",
];
