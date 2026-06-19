// Parses the plaintext body of Taiga's "Yesterdays Fuel Sales Report" email.
// Format: a flattened HTML table -> one value per line. A fixed 8-column header
// (Store Id, Store Name, Total Gallons, Comparison Gallons, Gallons Change,
// Total Fuel $, Comparison Total Fuel $, Fuel $ Change) is followed by a variable
// number of fuel-type columns (Regular, Plus, Premium, ...). Each store's row
// repeats that same column count, until a "<n> Total Results" footer row.

export interface FuelSalesRow {
  reportDate: string; // YYYY-MM-DD
  storeId: string;
  storeName: string;
  fuelType: string; // 'TOTAL' for the store-level total row, else a specific fuel type
  gallons: number | null;
  dollars: number | null;
  comparisonGallons: number | null;
  comparisonDollars: number | null;
}

const FIXED_COLUMNS = [
  "Store Id",
  "Store Name",
  "Total Gallons",
  "Comparison Gallons",
  "Gallons Change",
  "Total Fuel $",
  "Comparison Total Fuel $",
  "Fuel $ Change",
];

function parseNumeric(raw: string): number | null {
  const cleaned = raw.replace(/\$/g, "").replace(/,/g, "").trim();
  if (cleaned === "-" || cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Lines like "9.7% [https://.../arrow-...png]" — strip the trailing image link.
function stripTrailingImageLink(line: string): string {
  return line.replace(/\s*\[https?:\/\/\S+\]\s*$/, "").trim();
}

/**
 * Extracts the date from a subject like "Yesterdays Fuel Sales Report [06/18/2026]".
 */
export function extractReportDate(subject: string): string | null {
  const match = subject.match(/\[(\d{2})\/(\d{2})\/(\d{4})\]/);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

export function parseFuelSalesReport(
  body: string,
  subject: string
): FuelSalesRow[] {
  const reportDate = extractReportDate(subject);
  if (!reportDate) {
    throw new Error(`Could not extract report date from subject: ${subject}`);
  }

  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const headerStart = lines.findIndex((l) => l === "Store Id");
  if (headerStart === -1) {
    throw new Error("Could not find 'Store Id' header in fuel sales report body");
  }

  // Fuel-type columns run from right after the fixed header until the first
  // line that looks like a numeric store id (the start of the data section).
  const fuelTypeColumns: string[] = [];
  let dataStart = -1;
  for (let i = headerStart + FIXED_COLUMNS.length; i < lines.length; i++) {
    if (/^\d+$/.test(lines[i])) {
      dataStart = i;
      break;
    }
    fuelTypeColumns.push(lines[i]);
  }
  if (dataStart === -1) {
    throw new Error("Could not find start of store data in fuel sales report body");
  }

  const recordLength = FIXED_COLUMNS.length + fuelTypeColumns.length;
  const rows: FuelSalesRow[] = [];

  let i = dataStart;
  while (i < lines.length) {
    if (/total results/i.test(lines[i])) break; // footer summary row, not a store
    const record = lines.slice(i, i + recordLength);
    if (record.length < recordLength) break;

    const storeId = record[0];
    const storeName = record[1];
    const totalGallons = parseNumeric(record[2]);
    const comparisonGallons = parseNumeric(record[3]);
    const totalDollars = parseNumeric(stripTrailingImageLink(record[5]));
    const comparisonDollars = parseNumeric(stripTrailingImageLink(record[6]));

    rows.push({
      reportDate,
      storeId,
      storeName,
      fuelType: "TOTAL",
      gallons: totalGallons,
      dollars: totalDollars,
      comparisonGallons,
      comparisonDollars,
    });

    const fuelValues = record.slice(FIXED_COLUMNS.length);
    fuelValues.forEach((raw, idx) => {
      const gallons = parseNumeric(raw);
      if (gallons === null) return; // skip fuel types this store didn't sell
      rows.push({
        reportDate,
        storeId,
        storeName,
        fuelType: fuelTypeColumns[idx],
        gallons,
        dollars: null, // report doesn't break dollars out by fuel type
        comparisonGallons: null,
        comparisonDollars: null,
      });
    });

    i += recordLength;
  }

  return rows;
}
