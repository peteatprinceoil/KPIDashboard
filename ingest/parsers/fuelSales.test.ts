import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractReportDate, parseFuelSalesReport } from "./fuelSales";

const fixtureBody = readFileSync(
  join(__dirname, "__fixtures__/fuel-sales-report.txt"),
  "utf-8"
);
const subject = "Fw: Yesterdays Fuel Sales Report [06/18/2026]";

describe("extractReportDate", () => {
  it("parses MM/DD/YYYY out of the subject line", () => {
    expect(extractReportDate(subject)).toBe("2026-06-18");
  });

  it("returns null when no date is present", () => {
    expect(extractReportDate("Some other subject")).toBeNull();
  });
});

describe("parseFuelSalesReport", () => {
  const rows = parseFuelSalesReport(fixtureBody, subject);

  it("emits one TOTAL row per store, matching the 9 stores in the sample", () => {
    const totalRows = rows.filter((r) => r.fuelType === "TOTAL");
    expect(totalRows).toHaveLength(9);
  });

  it("parses the first store's totals correctly", () => {
    const newtonCrossing = rows.find(
      (r) => r.storeId === "2004" && r.fuelType === "TOTAL"
    );
    expect(newtonCrossing).toMatchObject({
      reportDate: "2026-06-18",
      storeId: "2004",
      storeName: "Newton Crossing",
      gallons: 6529.666,
      comparisonGallons: 7231.355,
      dollars: 27710.73,
      comparisonDollars: 31822.0,
    });
  });

  it("emits per-fuel-type rows only for fuel types the store actually sold", () => {
    const newtonCrossingFuels = rows.filter(
      (r) => r.storeId === "2004" && r.fuelType !== "TOTAL"
    );
    // Regular, Plus, Premium, Diesel, and Diesel Exhaust Fluid had non-dash values
    expect(newtonCrossingFuels.map((r) => r.fuelType)).toEqual([
      "Regular",
      "Plus",
      "Premium",
      "Diesel",
      "Diesel Exhaust Fluid",
    ]);
    expect(newtonCrossingFuels.find((r) => r.fuelType === "Regular")?.gallons).toBe(
      2482.216
    );
  });

  it("does not treat the footer 'Total Results' row as a store", () => {
    expect(rows.some((r) => r.storeId.includes("Total"))).toBe(false);
  });

  it("never produces NaN values", () => {
    for (const row of rows) {
      for (const value of [row.gallons, row.dollars, row.comparisonGallons, row.comparisonDollars]) {
        if (value !== null) expect(Number.isNaN(value)).toBe(false);
      }
    }
  });
});
