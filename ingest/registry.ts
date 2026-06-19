import { parseFuelSalesReport } from "./parsers/fuelSales";

export interface ParsedRows {
  table: string;
  rows: Record<string, unknown>[];
  onConflict: string; // comma-separated column names for upsert dedupe
}

export interface RegistryEntry {
  pattern: RegExp;
  reportType: string;
  parse: (body: string, subject: string) => ParsedRows;
}

// Add a new entry here when a new Taiga report type starts arriving.
export const registry: RegistryEntry[] = [
  {
    pattern: /fuel sales report/i,
    reportType: "fuel_sales_daily",
    parse: (body, subject) => ({
      table: "fuel_sales_daily",
      onConflict: "report_date,store_id,fuel_type",
      rows: parseFuelSalesReport(body, subject).map((r) => ({
        report_date: r.reportDate,
        store_id: r.storeId,
        store_name: r.storeName,
        fuel_type: r.fuelType,
        gallons: r.gallons,
        dollars: r.dollars,
        comparison_gallons: r.comparisonGallons,
        comparison_dollars: r.comparisonDollars,
      })),
    }),
  },
];

export function findParser(subject: string): RegistryEntry | undefined {
  return registry.find((e) => e.pattern.test(subject));
}
