import { getTaigaSupabaseClient } from "@/lib/taiga-supabase";
import { getSupabaseServerClient } from "@/lib/supabase";
import {
  getGallonTrend,
  getGallonTrendFallback,
  getStoreGallonsMtd,
  getStoreGallonsMtdFallback,
  getMarginStatus,
  getTopBottomProducts,
  getVoids,
  getCombos,
  getLastReportDate,
  getLastReportDateFallback,
  type GallonTrend,
  type PeriodComparison,
  type StoreGallons,
  type MarginData,
  type TopBottomResult,
  type VoidsResult,
  type CombosResult,
} from "@/lib/kpis";

export const dynamic = "force-dynamic";

// ── Formatters ────────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function fmtGallons(n: number | null): string {
  if (n === null) return "—";
  return Math.round(n).toLocaleString("en-US");
}

function fmtPct(n: number | null): string {
  if (n === null) return "";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtMonthYear(dateRange: string): string {
  const [y, m] = dateRange.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function fmtIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function fmtToday(d: Date): string {
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TrendCard({
  period,
  data,
}: {
  period: string;
  data: PeriodComparison | null;
}) {
  const hasNumber = data !== null && data.current !== null;
  return (
    <div className="t-card">
      <div className="t-period">{period} &middot; Gallons</div>
      <div className="t-sep" aria-hidden="true" />
      {hasNumber ? (
        <>
          <div className="t-number">{fmtGallons(data!.current)}</div>
          {data!.priorYear !== null ? (
            <div className="t-delta">
              <span className={`t-pct ${(data!.changePercent ?? 0) >= 0 ? "up" : "dn"}`}>
                {fmtPct(data!.changePercent)}
              </span>
              <span className="t-py">vs {fmtGallons(data!.priorYear)} LY</span>
            </div>
          ) : (
            <div className="t-no-py">no prior-year data yet</div>
          )}
        </>
      ) : (
        <>
          <div className="t-empty">&mdash;</div>
          <div className="t-no-py">no data yet</div>
        </>
      )}
    </div>
  );
}

function MarginPanel({ data }: { data: MarginData }) {
  if (!data.available) {
    return (
      <div className="s-panel">
        <div className="s-title">Store Margin</div>
        <div className="s-sub">≥40% green &middot; within 2% yellow &middot; &gt;2% off red</div>
        <div className="s-dots" aria-hidden="true">
          {[0,1,2].map((i) => <span key={i} className="s-dot" />)}
        </div>
        <div className="s-reason">{data.reason}</div>
      </div>
    );
  }

  return (
    <div className="s-panel">
      <div className="s-title">Store Margin</div>
      <div className="s-sub">
        vs {data.targetPercent}% target &middot; {fmtMonthYear(data.period)}
      </div>
      <div className="rag-list" role="list">
        {data.stores.map((s) => (
          <div key={s.storeId} className="rag-row" role="listitem">
            <span className={`rag-dot ${s.status}`} aria-label={s.status} />
            <span className="rag-store">{s.storeName}</span>
            <span className="rag-pct">{s.marginPercent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductsPanel({ data }: { data: TopBottomResult }) {
  if (!data.available) {
    return (
      <div className="s-panel">
        <div className="s-title">Top &amp; Bottom Items</div>
        <div className="s-sub">Best 5 sellers &middot; Slowest 5 sellers</div>
        <div className="s-dots" aria-hidden="true">
          {[0,1,2,3,4].map((i) => <span key={i} className="s-dot" />)}
        </div>
        <div className="s-reason">{data.reason}</div>
      </div>
    );
  }

  return (
    <div className="s-panel">
      <div className="s-title">Top &amp; Bottom Items</div>
      <div className="s-sub">Units sold &middot; {fmtMonthYear(data.period)} &middot; all stores</div>
      <div className="rank-cols">
        <div>
          <div className="rank-col-label">Top 5</div>
          {data.top5.map((p) => (
            <div key={p.productName} className="rank-row">
              <span className="rank-name" title={p.productName}>{p.productName}</span>
              <span className="rank-units">{p.unitsSold.toLocaleString("en-US")}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="rank-col-label">Bottom 5</div>
          {data.bottom5.map((p) => (
            <div key={p.productName} className="rank-row">
              <span className="rank-name" title={p.productName}>{p.productName}</span>
              <span className="rank-units">{p.unitsSold.toLocaleString("en-US")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StubPanel({
  title,
  sub,
  dotCount = 5,
  reason,
}: {
  title: string;
  sub: string;
  dotCount?: number;
  reason: string;
}) {
  return (
    <div className="s-panel">
      <div className="s-title">{title}</div>
      <div className="s-sub">{sub}</div>
      <div className="s-dots" aria-hidden="true">
        {Array.from({ length: dotCount }).map((_, i) => (
          <span key={i} className="s-dot" />
        ))}
      </div>
      <div className="s-reason">{reason}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function Page() {
  const emptyPeriod: PeriodComparison = { current: null, priorYear: null, changePercent: null };
  const emptyTrend: GallonTrend = {
    asOf: new Date().toISOString().slice(0, 10),
    mtd: emptyPeriod, qtd: emptyPeriod, ytd: emptyPeriod,
  };

  let gallonTrend: GallonTrend = emptyTrend;
  let storeGallons: StoreGallons[] = [];
  let marginData: MarginData = { available: false, reason: "Database not configured." };
  let topBottomData: TopBottomResult = { available: false, reason: "Database not configured." };
  let voidsData: VoidsResult = { available: false, reason: "Database not configured." };
  let combosData: CombosResult = { available: false, reason: "Database not configured." };
  let lastReportDate: string | null = null;

  try {
    const taiga = getTaigaSupabaseClient(); // Taiga DB — margin/product data + fallback gallons

    // Try our own DB first (has fuel_sales_daily with daily gallons + LY comparison).
    // Falls back to Taiga's transaction_summary if the key isn't configured —
    // that gives correct current-year MTD but no LY comparison.
    let ownDbAvailable = false;
    try {
      const db = getSupabaseServerClient();
      lastReportDate = await getLastReportDate(db);
      const asOf = lastReportDate ? new Date(lastReportDate + "T12:00:00Z") : new Date();
      [gallonTrend, storeGallons] = await Promise.all([
        getGallonTrend(db, asOf),
        getStoreGallonsMtd(db, asOf),
      ]);
      ownDbAvailable = true;
    } catch {
      // Own DB not configured — use Taiga transaction_summary for gallons
      lastReportDate = await getLastReportDateFallback(taiga);
      const asOf = lastReportDate ? new Date(lastReportDate + "T12:00:00Z") : new Date();
      [gallonTrend, storeGallons] = await Promise.all([
        getGallonTrendFallback(taiga, asOf),
        getStoreGallonsMtdFallback(taiga, asOf),
      ]);
    }
    void ownDbAvailable;

    [marginData, topBottomData] = await Promise.all([
      getMarginStatus(taiga),
      getTopBottomProducts(taiga),
    ]);
    [voidsData, combosData] = await Promise.all([getVoids(), getCombos()]);
  } catch {
    // Taiga DB not configured — render empty states
  }

  const today = new Date();
  const maxGallons = storeGallons.length > 0
    ? Math.max(...storeGallons.map((s) => s.gallons))
    : 1;

  return (
    <main className="page">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="hd">
        <div className="hd-left">
          <span className="brand">Prince Oil</span>
          <span className="brand-sep" aria-hidden="true">/</span>
          <span className="brand-sub">CFO Briefing</span>
        </div>
        <div className="hd-right">
          <span className="hd-date">{fmtToday(today)}</span>
          {lastReportDate && (
            <span className="hd-report">Last data: {fmtIsoDate(lastReportDate)}</span>
          )}
        </div>
      </header>

      {/* ── Gallon Trend ───────────────────────────────────────────────── */}
      <section className="sec">
        <h2 className="sec-label">Gallon Trend</h2>
        <div className="trend-row">
          <TrendCard period="MTD" data={gallonTrend.mtd} />
          <TrendCard period="QTD" data={gallonTrend.qtd} />
          <TrendCard period="YTD" data={gallonTrend.ytd} />
        </div>
      </section>

      {/* ── Stores: MTD Gallons ────────────────────────────────────────── */}
      {storeGallons.length > 0 && (
        <section className="sec">
          <h2 className="sec-label">Stores &middot; MTD Gallons</h2>
          <div className="bars" role="list">
            {storeGallons.map((s) => (
              <div key={s.storeId} className="bar-row" role="listitem">
                <span className="bar-name">{s.storeName}</span>
                <div className="bar-track" aria-hidden="true">
                  <div
                    className="bar-fill"
                    style={{ width: `${(s.gallons / maxGallons) * 100}%` }}
                  />
                </div>
                <span className="bar-val">{fmtGallons(s.gallons)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Operations ─────────────────────────────────────────────────── */}
      <section className="sec">
        <h2 className="sec-label">Operations</h2>
        <div className="stub-grid">
          <MarginPanel data={marginData} />
          <ProductsPanel data={topBottomData} />
          <StubPanel
            title="Voids &amp; No-Sales"
            sub="Per store, daily count"
            dotCount={4}
            reason={voidsData.available ? "" : voidsData.reason}
          />
          <StubPanel
            title="Meal Combos"
            sub="Breakfast pairings &middot; Lunch pairings"
            dotCount={5}
            reason={combosData.available ? "" : combosData.reason}
          />
        </div>
      </section>

      {/* ── Inventory ──────────────────────────────────────────────────── */}
      <section className="sec">
        <h2 className="sec-label">Inventory</h2>
        <div className="stub-wide">
          <span className="stub-wide-label">PDI Report</span>
          <span className="stub-wide-msg">
            Awaiting PDI integration — Ben to set up a recurring inventory email from PDI.
          </span>
        </div>
      </section>

      <footer className="foot">
        Data sourced from Taiga &middot; Updated nightly
      </footer>

    </main>
  );
}
