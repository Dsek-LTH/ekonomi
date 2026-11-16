import { describe, expect, it } from "vitest";
import { postingGaps, type StockBookingSettings } from "./setup";

const alcohol: StockBookingSettings = {
  stock: "alcohol",
  purchaseMode: "CAPITALISED",
  purchaseOffsetAccount: null,
  boardCostAccount: null,
  boardSalesAccount: null,
  postingStartsOn: "2027-01-01",
  groups: [
    { name: "Öl", stockAccount: "1461", consumptionAccount: "4011", products: 3 },
    { name: "Vin", stockAccount: null, consumptionAccount: null, products: 0 },
  ],
};

describe("postingGaps", () => {
  it("is empty when every type in use has its accounts", () => {
    expect(postingGaps(alcohol)).toEqual([]);
  });

  it("asks for both accounts of a type that has products", () => {
    const gaps = postingGaps({
      ...alcohol,
      groups: [{ name: "Vin", stockAccount: null, consumptionAccount: null, products: 1 }],
    });
    expect(gaps).toEqual([
      { key: "stockAccount", group: "Vin" },
      { key: "consumptionAccount", group: "Vin" },
    ]);
  });

  it("asks an expensed stock for the account its purchases were booked on", () => {
    const gaps = postingGaps({
      ...alcohol,
      stock: "cafe",
      purchaseMode: "EXPENSED",
      boardCostAccount: "4090",
    });
    expect(gaps).toEqual([{ key: "purchaseOffsetAccount" }]);
  });

  it("asks the café for where the board's withdrawals are charged", () => {
    const gaps = postingGaps({
      ...alcohol,
      stock: "cafe",
      purchaseMode: "EXPENSED",
      purchaseOffsetAccount: "4010",
    });
    expect(gaps).toEqual([{ key: "boardCostAccount" }]);
  });

  it("asks for the day posting starts", () => {
    expect(postingGaps({ ...alcohol, postingStartsOn: null })).toEqual([
      { key: "postingStartsOn" },
    ]);
  });
});
