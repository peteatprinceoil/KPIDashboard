import type { SupabaseClient } from "@supabase/supabase-js";

// All data comes from the Taiga Supabase (one database).
//
// Current-year gallons   → transaction_daily  (daily per-store rows, reliable from April 2026)
// Prior-year gallons     → transaction_summary (monthly per-store rows, reliable from June 2024)
//
// LY MTD comparison: the partial current month in the prior year is unavailable at
// daily granularity, so we scale the full prior-year month by (day / days_in_month).
// Complete prior-year months (QTD/YTD) are summed exactly.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PeriodComparison {
  current: number | null;
  priorYear: number | null;
  changePercent: number | null;
}

export interface GallonTrend {
  asOf: string;
  mtd: PeriodComparison;
  qtd: PeriodComparison;
  ytd: PeriodComparison;
}

export interface StoreGallons {
  storeId: string;
  storeName: string;
  gallons: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugToTitle(slug: string): string {
  return slug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getDate();
}

function monthKeysBetween(fromDate: string, toDate: string): string[] {
  const keys: string[] = [];
  const [fy, fm] = fromDate.slice(0, 7).split("-").map(Number);
  const [ty, tm] = toDate.slice(0, 7).split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return keys;
}

function comparison(current: number | null, prior: number | null): PeriodComparison {
  const changePercent =
    current !== null && prior !== null && prior !== 0
      ? ((current - prior) / prior) * 100
      : null;
  return { current, priorYear: prior, changePercent };
}

// Sum gallons_pumped from transaction_summary for the given month keys.
// The partial month (current month in LY) is scaled by dayFraction.
async function sumSummaryGallons(
  supabase: SupabaseClient,
  monthKeys: string[],
  partialMonthKey: string | null,   // the month to scale
  dayFraction: number               // day / daysInMonth
): Promise<number | null> {
  if (monthKeys.length === 0) return null;

  const { data, error } = await supabase
    .from("transaction_summary")
    .select("date_range, gallons_pumped")
    .in("date_range", monthKeys);

  if (error || !data || data.length === 0) return null;

  const rows = data as { date_range: string; gallons_pumped: number | null }[];
  const total = rows.reduce((sum, r) => {
    const g = r.gallons_pumped ?? 0;
    return sum + (r.date_range === partialMonthKey ? g * dayFraction : g);
  }, 0);

  return total > 0 ? total : null;
}

// Sum gallons_pumped from transaction_daily for a date range.
async function sumDailyGallons(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<number | null> {
  const { data, error } = await supabase
    .from("transaction_daily")
    .select("gallons_pumped")
    .gte("business_date", from)
    .lte("business_date", to);

  if (error || !data || data.length === 0) return null;
  const total = (data as { gallons_pumped: number | null }[]).reduce(
    (sum, r) => sum + (r.gallons_pumped ?? 0),
    0
  );
  return total > 0 ? total : null;
}

// ── Gallon Trend ──────────────────────────────────────────────────────────────

export async function getGallonTrend(
  supabase: SupabaseClient,
  asOf: Date = new Date()
): Promise<GallonTrend> {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth() + 1;
  const d = asOf.getUTCDate();
  const today = asOf.toISOString().slice(0, 10);

  const quarter = Math.ceil(m / 3);
  const qtdStartMonth = (quarter - 1) * 3 + 1;

  const pad = (n: number) => String(n).padStart(2, "0");
  const mtdStart  = `${y}-${pad(m)}-01`;
  const qtdStart  = `${y}-${pad(qtdStartMonth)}-01`;
  const ytdStart  = `${y}-01-01`;

  // Current year: transaction_daily has reliable daily data
  const [mtdCur, qtdCur, ytdCur] = await Promise.all([
    sumDailyGallons(supabase, mtdStart, today),
    sumDailyGallons(supabase, qtdStart, today),
    sumDailyGallons(supabase, ytdStart, today),
  ]);

  // Prior year: transaction_summary (monthly). The current month in LY is partial —
  // scale it by (day / daysInMonth) since we only have the full-month total.
  const lyYear = y - 1;
  const lyPartialKey = `${lyYear}-${pad(m)}`;
  const dayFraction = d / daysInMonth(lyYear, m);

  const lyMtdKeys  = [`${lyYear}-${pad(m)}`];
  const lyQtdKeys  = monthKeysBetween(`${lyYear}-${pad(qtdStartMonth)}-01`, `${lyYear}-${pad(m)}-01`);
  const lyYtdKeys  = monthKeysBetween(`${lyYear}-01-01`, `${lyYear}-${pad(m)}-01`);

  const [mtdPy, qtdPy, ytdPy] = await Promise.all([
    sumSummaryGallons(supabase, lyMtdKeys, lyPartialKey, dayFraction),
    sumSummaryGallons(supabase, lyQtdKeys, lyPartialKey, dayFraction),
    sumSummaryGallons(supabase, lyYtdKeys, lyPartialKey, dayFraction),
  ]);

  return {
    asOf: today,
    mtd: comparison(mtdCur, mtdPy),
    qtd: comparison(qtdCur, qtdPy),
    ytd: comparison(ytdCur, ytdPy),
  };
}

// ── Store Gallons MTD ─────────────────────────────────────────────────────────

export async function getStoreGallonsMtd(
  supabase: SupabaseClient,
  asOf: Date = new Date()
): Promise<StoreGallons[]> {
  const y = asOf.getUTCFullYear();
  const m = String(asOf.getUTCMonth() + 1).padStart(2, "0");
  const mtdStart = `${y}-${m}-01`;
  const today = asOf.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("transaction_daily")
    .select("store_id, gallons_pumped")
    .gte("business_date", mtdStart)
    .lte("business_date", today);

  const byStore = new Map<string, number>();
  for (const row of (data ?? []) as { store_id: string; gallons_pumped: number | null }[]) {
    byStore.set(row.store_id, (byStore.get(row.store_id) ?? 0) + (row.gallons_pumped ?? 0));
  }

  return [...byStore.entries()]
    .map(([storeId, gallons]) => ({
      storeId,
      storeName: slugToTitle(storeId),
      gallons,
    }))
    .sort((a, b) => b.gallons - a.gallons);
}

// ── Last Report Date ──────────────────────────────────────────────────────────

export async function getLastReportDate(
  supabase: SupabaseClient
): Promise<string | null> {
  // Use transaction_daily — it has daily granularity and reliable data from April 2026.
  // Filter to rows with meaningful gallons to exclude old bad data.
  const { data, error } = await supabase
    .from("transaction_daily")
    .select("business_date")
    .gt("gallons_pumped", 100)
    .order("business_date", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return (data as { business_date: string }).business_date;
}

// ── Margin RAG ────────────────────────────────────────────────────────────────

export type RagStatus = "green" | "yellow" | "red";

export interface StoreMargin {
  storeId: string;
  storeName: string;
  marginPercent: number;
  status: RagStatus;
}

export type MarginData =
  | { available: true; targetPercent: number; period: string; stores: StoreMargin[] }
  | { available: false; reason: string };

const MARGIN_TARGET = 0.40;
const MARGIN_YELLOW_FLOOR = 0.38;

function ragStatus(margin: number): RagStatus {
  if (margin >= MARGIN_TARGET) return "green";
  if (margin >= MARGIN_YELLOW_FLOOR) return "yellow";
  return "red";
}

export async function getMarginStatus(
  supabase: SupabaseClient
): Promise<MarginData> {
  const { data: latestRow, error: latestErr } = await supabase
    .from("transaction_summary")
    .select("date_range")
    .order("date_range", { ascending: false })
    .limit(1)
    .single();

  if (latestErr || !latestRow) {
    return { available: false, reason: "No margin data available." };
  }

  const { data: margins } = await supabase
    .from("transaction_summary")
    .select("store_id, total_margin")
    .eq("date_range", latestRow.date_range)
    .order("total_margin", { ascending: false });

  if (!margins || margins.length === 0) {
    return { available: false, reason: "No margin data for the latest period." };
  }

  const stores: StoreMargin[] = (
    margins as { store_id: string; total_margin: number | null }[]
  )
    .filter((r) => r.total_margin !== null)
    .map((r) => ({
      storeId: r.store_id,
      storeName: slugToTitle(r.store_id),
      marginPercent: Math.round(r.total_margin! * 100 * 10) / 10,
      status: ragStatus(r.total_margin!),
    }));

  return {
    available: true,
    targetPercent: 40,
    period: latestRow.date_range,
    stores,
  };
}

// ── Top / Bottom Products ─────────────────────────────────────────────────────

export interface ProductRanking {
  rank: number;
  productName: string;
  unitsSold: number;
  totalSales: number;
}

export type TopBottomResult =
  | { available: true; period: string; top5: ProductRanking[]; bottom5: ProductRanking[] }
  | { available: false; reason: string };

export async function getTopBottomProducts(
  supabase: SupabaseClient
): Promise<TopBottomResult> {
  const { data: latestRow, error } = await supabase
    .from("merchandise_product")
    .select("date_range")
    .order("date_range", { ascending: false })
    .limit(1)
    .single();

  if (error || !latestRow) {
    return { available: false, reason: "No product data available." };
  }

  const { data: rows } = await supabase
    .from("merchandise_product")
    .select("product_name, units_sold, total_sales_amount")
    .eq("date_range", latestRow.date_range);

  if (!rows || rows.length === 0) {
    return { available: false, reason: "No product data for the latest period." };
  }

  const agg = new Map<string, { units: number; sales: number }>();
  for (const r of rows as { product_name: string; units_sold: number | null; total_sales_amount: number | null }[]) {
    const existing = agg.get(r.product_name) ?? { units: 0, sales: 0 };
    agg.set(r.product_name, {
      units: existing.units + (r.units_sold ?? 0),
      sales: existing.sales + (r.total_sales_amount ?? 0),
    });
  }

  const sorted = [...agg.entries()]
    .map(([name, { units, sales }]) => ({ name, units, sales }))
    .filter((p) => p.units > 0)
    .sort((a, b) => b.units - a.units);

  const toRanking = (items: typeof sorted, offset = 0): ProductRanking[] =>
    items.map((p, i) => ({
      rank: offset + i + 1,
      productName: p.name,
      unitsSold: Math.round(p.units),
      totalSales: Math.round(p.sales * 100) / 100,
    }));

  const meaningful = sorted.filter((p) => p.units >= 10);
  const bottom5Raw = meaningful.slice(-5).reverse();

  return {
    available: true,
    period: latestRow.date_range,
    top5: toRanking(sorted.slice(0, 5)),
    bottom5: toRanking(bottom5Raw),
  };
}

// ── Voids ─────────────────────────────────────────────────────────────────────

export type VoidsResult =
  | { available: true; rows: unknown[] }
  | { available: false; reason: string };

export async function getVoids(): Promise<VoidsResult> {
  return { available: false, reason: "Void/no-sale data is not yet in the dataset." };
}

// ── Combos ────────────────────────────────────────────────────────────────────

export type CombosResult =
  | { available: true; combos: unknown[] }
  | { available: false; reason: string };

export async function getCombos(): Promise<CombosResult> {
  return { available: false, reason: "Basket-level pairing data is not yet in the dataset." };
}
