import { describe, expect, it } from "vitest";
import { bandOf, bandTodos, dueOf, todoItem, type TodoItem } from "./todo";

const TODAY = "2026-11-11";
const item = (id: string, due: string): TodoItem =>
  todoItem({ kind: "attestExpense", id, title: id, who: null, amount: null, due }, TODAY);

describe("dueOf", () => {
  it("gives an out-of-pocket draft until the filing deadline, a card draft a week", () => {
    expect(dueOf.draft("2026-11-01", false)).toBe("2026-12-31");
    expect(dueOf.draft("2026-11-01", true)).toBe("2026-11-08");
  });

  it("gives an attest three days, or less when the faktura is due sooner", () => {
    expect(dueOf.attest("2026-11-10")).toBe("2026-11-13");
    expect(dueOf.attest("2026-11-10", "2026-11-30")).toBe("2026-11-13");
    expect(dueOf.attest("2026-11-10", "2026-11-11")).toBe("2026-11-11");
  });

  it("makes a sent-back utlägg due the day it came back", () => {
    expect(dueOf.fix("2026-11-09")).toBe("2026-11-09");
  });
});

describe("bands", () => {
  it("splits late, this week and later", () => {
    expect(bandOf(-1)).toBe("late");
    expect(bandOf(0)).toBe("week");
    expect(bandOf(7)).toBe("week");
    expect(bandOf(8)).toBe("later");
  });

  it("sorts soonest first and leaves out empty bands", () => {
    const bands = bandTodos([
      item("c", "2026-11-14"),
      item("a", "2026-11-01"),
      item("b", "2026-11-12"),
    ]);
    expect(bands.map((b) => b.band)).toEqual(["late", "week"]);
    expect(bands[1].items.map((i) => i.id)).toEqual(["b", "c"]);
  });
});
