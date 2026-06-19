import type { SupabaseClient } from "@supabase/supabase-js";

// ── Gallon Trend ────────────────────────────────────────────────────────────

export interface PeriodComparison {
  current: number | null; // null = no data for this period yet
  priorYear: number | null; // null = no prior-year data yet
  changePercent: number | null;
}

export interface GallonTrend {
  asOf: string; // YYYY-MM-DD
  mtd: PeriodComparison;
  qtd: PeriodComparison;
  ytd: PeriodComparison;
}

function periodBounds(asOf: Date): {
  mtdStart: string;
  qtdStart: string;
  ytdStart: string;
  pyMtdStart: string;
  pyQtdStart: string;
  pyYtdStart: string;
  pyAsOf: string;
} {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth() + 1; // 1-based
  const quarter = Math.ceil(m / 3);
  const qtdMonth = (quarter - 1) * 3 + 1;

  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (yr: number, mo: number, d: number) =>
    `${yr}-${pad(mo)}-${pad(d)}`;

  return {
    mtdStart: iso(y, m, 1),
    qtdStart: iso(y, qtdMonth, 1),
    ytdStart: iso(y, 1, 1),
    pyMtdStart: iso(y - 1, m, 1),
    pyQtdStart: iso(y - 1, qtdMonth, 1),
    pyYtdStart: iso(y - 1, 1, 1),
    pyAsOf: iso(y - 1, m, asOf.getUTCDate()),
  };
}

async function sumGallons(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<number | null> {
  const { data, error } = await supabase
    .from("fuel_sales_daily")
    .select("gallons")
    .eq("fuel_type", "TOTAL")
    .gte("report_date", from)
    .lte("report_date", to);

  if (error) throw new Error(`sumGallons(${from}→${to}): ${error.message}`);
  if (!data || data.length === 0) return null;

  const total = (data as { gallons: number | null }[]).reduce(
    (acc, row) => acc + (row.gallons ?? 0),
    0
  );
  return total;
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

// ── Store-level gallon totals (for per-store breakdowns) ─────────────────────

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

  const { data, error } = await supabase
    .from("fuel_sales_daily")
    .select("store_id, store_name, gallons")
    .eq("fuel_type", "TOTAL")
    .gte("report_date", mtdStart)
    .lte("report_date", today);

  if (error) throw new Error(`getStoreGallonsMtd: ${error.message}`);

  const byStore = new Map<string, StoreGallons>();
  for (const row of (data ?? []) as {
    store_id: string;
    store_name: string;
    gallons: number | null;
  }[]) {
    const existing = byStore.get(row.store_id);
    if (existing) {
      existing.gallons += row.gallons ?? 0;
    } else {
      byStore.set(row.store_id, {
        storeId: row.store_id,
        storeName: row.store_name,
        gallons: row.gallons ?? 0,
      });
    }
  }

  return [...byStore.values()].sort((a, b) => b.gallons - a.gallons);
}

// ── Margin RAG ───────────────────────────────────────────────────────────────

export type RagStatus = "green" | "yellow" | "red";

export interface StoreMargin {
  storeId: string;
  storeName: string;
  marginPercent: number;
  status: RagStatus;
}

export interface MarginResult {
  available: false;
  reason: string;
}

export type MarginData =
  | { available: true; targetPercent: number; stores: StoreMargin[] }
  | MarginResult;

const MARGIN_TARGET = 40; // %
const MARGIN_YELLOW_THRESHOLD = 2; // within 2% = yellow

export async function getMarginStatus(
  supabase: SupabaseClient
): Promise<MarginData> {
  const { data, error } = await supabase
    .from("margin_daily")
    .select("store_id")
    .limit(1);

  if (error || !data || data.length === 0) {
    return {
      available: false,
      reason:
        "No margin data yet. Ask Ben to schedule a Taiga margin report to the AgentMail inbox.",
    };
  }

  // Real implementation: query margin_daily, aggregate, apply RAG thresholds.
  // Placeholder until the margin parser lands.
  return {
    available: false,
    reason: "Margin parser not yet implemented.",
  };
}

// ── Top / Bottom Products ────────────────────────────────────────────────────

export interface ProductRanking {
  rank: number;
  sku: string;
  productName: string;
  unitsSold: number;
  storeId: string;
  storeName: string;
}

export type TopBottomResult =
  | { available: true; top5: ProductRanking[]; bottom5: ProductRanking[] }
  | { available: false; reason: string };

export async function getTopBottomProducts(
  supabase: SupabaseClient
): Promise<TopBottomResult> {
  const { data, error } = await supabase
    .from("top_products")
    .select("store_id")
    .limit(1);

  if (error || !data || data.length === 0) {
    return {
      available: false,
      reason:
        "No product ranking data yet. Ask Ben to schedule a Taiga top-sellers report to the AgentMail inbox.",
    };
  }

  return { available: false, reason: "Top-products parser not yet implemented." };
}

// ── Voids / No-Sales ─────────────────────────────────────────────────────────

export interface VoidCount {
  storeId: string;
  storeName: string;
  reportDate: string;
  voids: number;
  noSales: number;
}

export type VoidsResult =
  | { available: true; rows: VoidCount[] }
  | { available: false; reason: string };

export async function getVoids(
  supabase: SupabaseClient
): Promise<VoidsResult> {
  const { data, error } = await supabase
    .from("voids")
    .select("store_id")
    .limit(1);

  if (error || !data || data.length === 0) {
    return {
      available: false,
      reason:
        "No voids data yet. Ask Ben to schedule a Taiga voids/no-sales report to the AgentMail inbox.",
    };
  }

  return { available: false, reason: "Voids parser not yet implemented." };
}

// ── Meal Combos ──────────────────────────────────────────────────────────────

export interface ComboInsight {
  daypart: "breakfast" | "lunch";
  anchorItem: string;
  pairedItem: string;
  count: number;
  storeId: string;
  storeName: string;
}

export type CombosResult =
  | { available: true; combos: ComboInsight[] }
  | { available: false; reason: string };

export async function getCombos(
  supabase: SupabaseClient
): Promise<CombosResult> {
  const { data, error } = await supabase
    .from("combo_sales")
    .select("store_id")
    .limit(1);

  if (error || !data || data.length === 0) {
    return {
      available: false,
      reason:
        "No combo data yet. Ask Ben to schedule a Taiga item-pairing report to the AgentMail inbox.",
    };
  }

  return { available: false, reason: "Combo parser not yet implemented." };
}

// ── Last Report Date ──────────────────────────────────────────────────────────

export async function getLastReportDate(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data, error } = await supabase
    .from("fuel_sales_daily")
    .select("report_date")
    .order("report_date", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return (data as { report_date: string }).report_date;
}
