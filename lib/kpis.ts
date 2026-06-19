import type { SupabaseClient } from "@supabase/supabase-js";

// ── Gallon Trend ──────────────────────────────────────────────────────────────
// Source: transaction_daily.gallons_pumped (Taiga DB)

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

function periodBounds(asOf: Date) {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth() + 1;
  const quarter = Math.ceil(m / 3);
  const qtdMonth = (quarter - 1) * 3 + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (yr: number, mo: number, d: number) =>
    `${yr}-${pad(mo)}-${pad(d)}`;
  return {
    mtdStart:   iso(y, m, 1),
    qtdStart:   iso(y, qtdMonth, 1),
    ytdStart:   iso(y, 1, 1),
    pyMtdStart: iso(y - 1, m, 1),
    pyQtdStart: iso(y - 1, qtdMonth, 1),
    pyYtdStart: iso(y - 1, 1, 1),
    pyAsOf:     iso(y - 1, m, asOf.getUTCDate()),
  };
}

async function sumGallons(
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

function comparison(
  current: number | null,
  prior: number | null
): PeriodComparison {
  const changePercent =
    current !== null && prior !== null && prior !== 0
      ? ((current - prior) / prior) * 100
      : null;
  return { current, priorYear: prior, changePercent };
}

export async function getGallonTrend(
  supabase: SupabaseClient,
  asOf: Date = new Date()
): Promise<GallonTrend> {
  const b = periodBounds(asOf);
  const today = asOf.toISOString().slice(0, 10);

  const [mtdCur, qtdCur, ytdCur, mtdPy, qtdPy, ytdPy] = await Promise.all([
    sumGallons(supabase, b.mtdStart, today),
    sumGallons(supabase, b.qtdStart, today),
    sumGallons(supabase, b.ytdStart, today),
    sumGallons(supabase, b.pyMtdStart, b.pyAsOf),
    sumGallons(supabase, b.pyQtdStart, b.pyAsOf),
    sumGallons(supabase, b.pyYtdStart, b.pyAsOf),
  ]);

  return {
    asOf: today,
    mtd: comparison(mtdCur, mtdPy),
    qtd: comparison(qtdCur, qtdPy),
    ytd: comparison(ytdCur, ytdPy),
  };
}

// ── Store Gallons MTD ─────────────────────────────────────────────────────────

export interface StoreGallons {
  storeId: string;
  storeName: string;
  gallons: number;
}

export async function getStoreGallonsMtd(
  supabase: SupabaseClient,
  asOf: Date = new Date()
): Promise<StoreGallons[]> {
  const y = asOf.getUTCFullYear();
  const m = String(asOf.getUTCMonth() + 1).padStart(2, "0");
  const mtdStart = `${y}-${m}-01`;
  const today = asOf.toISOString().slice(0, 10);

  const [{ data: dailyData }, { data: storesData }] = await Promise.all([
    supabase
      .from("transaction_daily")
      .select("store_id, gallons_pumped")
      .gte("business_date", mtdStart)
      .lte("business_date", today),
    supabase.from("stores").select("store_id, store_name"),
  ]);

  const nameMap = new Map(
    (storesData ?? []).map((s: { store_id: string; store_name: string }) => [
      s.store_id,
      s.store_name,
    ])
  );

  const byStore = new Map<string, number>();
  for (const row of (dailyData ?? []) as {
    store_id: string;
    gallons_pumped: number | null;
  }[]) {
    byStore.set(row.store_id, (byStore.get(row.store_id) ?? 0) + (row.gallons_pumped ?? 0));
  }

  return [...byStore.entries()]
    .map(([storeId, gallons]) => ({
      storeId,
      storeName: nameMap.get(storeId) ?? slugToTitle(storeId),
      gallons,
    }))
    .sort((a, b) => b.gallons - a.gallons);
}

// ── Margin RAG ────────────────────────────────────────────────────────────────
// Source: transaction_summary.total_margin (Taiga DB)
// total_margin is a decimal: 0.40 = 40%

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
const MARGIN_YELLOW_FLOOR = 0.38; // within 2 percentage points

function ragStatus(margin: number): RagStatus {
  if (margin >= MARGIN_TARGET) return "green";
  if (margin >= MARGIN_YELLOW_FLOOR) return "yellow";
  return "red";
}

export async function getMarginStatus(
  supabase: SupabaseClient
): Promise<MarginData> {
  // Find the most recent month
  const { data: latestRow, error: latestErr } = await supabase
    .from("transaction_summary")
    .select("date_range")
    .order("date_range", { ascending: false })
    .limit(1)
    .single();

  if (latestErr || !latestRow) {
    return { available: false, reason: "No margin data in Taiga yet." };
  }

  const [{ data: margins }, { data: storesData }] = await Promise.all([
    supabase
      .from("transaction_summary")
      .select("store_id, store_number, total_margin")
      .eq("date_range", latestRow.date_range)
      .order("total_margin", { ascending: false }),
    supabase.from("stores").select("store_id, store_name"),
  ]);

  if (!margins || margins.length === 0) {
    return { available: false, reason: "No margin data for the latest period." };
  }

  const nameMap = new Map(
    (storesData ?? []).map((s: { store_id: string; store_name: string }) => [
      s.store_id,
      s.store_name,
    ])
  );

  const stores: StoreMargin[] = (
    margins as { store_id: string; total_margin: number | null }[]
  )
    .filter((r) => r.total_margin !== null)
    .map((r) => ({
      storeId: r.store_id,
      storeName: nameMap.get(r.store_id) ?? slugToTitle(r.store_id),
      marginPercent: Math.round((r.total_margin! * 100) * 10) / 10,
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
// Source: merchandise_product (Taiga DB), aggregated across all stores

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
    return { available: false, reason: "No product data in Taiga yet." };
  }

  const { data: rows } = await supabase
    .from("merchandise_product")
    .select("product_name, units_sold, total_sales_amount")
    .eq("date_range", latestRow.date_range);

  if (!rows || rows.length === 0) {
    return { available: false, reason: "No product data for the latest period." };
  }

  // Aggregate by product_name across stores
  const agg = new Map<string, { units: number; sales: number }>();
  for (const r of rows as {
    product_name: string;
    units_sold: number | null;
    total_sales_amount: number | null;
  }[]) {
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

  const toRanking = (
    items: typeof sorted,
    offset = 0
  ): ProductRanking[] =>
    items.map((p, i) => ({
      rank: offset + i + 1,
      productName: p.name,
      unitsSold: Math.round(p.units),
      totalSales: Math.round(p.sales * 100) / 100,
    }));

  // Bottom 5: lowest-selling among items with at least 10 units (avoids single-sale noise)
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
// Not available in current Taiga schema

export type VoidsResult =
  | { available: true; rows: unknown[] }
  | { available: false; reason: string };

export async function getVoids(): Promise<VoidsResult> {
  return {
    available: false,
    reason: "Void/no-sale data is not yet in the Taiga dataset.",
  };
}

// ── Combos ────────────────────────────────────────────────────────────────────
// Not available in current Taiga schema

export type CombosResult =
  | { available: true; combos: unknown[] }
  | { available: false; reason: string };

export async function getCombos(): Promise<CombosResult> {
  return {
    available: false,
    reason: "Basket-level pairing data is not yet in the Taiga dataset.",
  };
}

// ── Last Report Date ──────────────────────────────────────────────────────────

export async function getLastReportDate(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data, error } = await supabase
    .from("transaction_daily")
    .select("business_date")
    .order("business_date", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return (data as { business_date: string }).business_date;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugToTitle(slug: string): string {
  return slug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
