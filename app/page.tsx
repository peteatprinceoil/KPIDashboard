import { getSupabaseServerClient } from "@/lib/supabase";
import {
  getGallonTrend,
  getStoreGallonsMtd,
  getMarginStatus,
  getTopBottomProducts,
  getVoids,
  getCombos,
  getLastReportDate,
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
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
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
  label,
  data,
}: {
  period: string;
  label: string;
  data: PeriodComparison | null;
}) {
  const hasNumber = data !== null && data.current !== null;

  return (
    <div className="t-card">
      <div className="t-period">{period} &middot; {label}</div>
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

function StubPanel({
  title,
  sub,
  dotCount,
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
        {Array.from({ length: dotCount ?? 5 }).map((_, i) => (
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
    mtd: emptyPeriod,
    qtd: emptyPeriod,
    ytd: emptyPeriod,
  };

  let gallonTrend: GallonTrend = emptyTrend;
  let storeGallons: StoreGallons[] = [];
  let marginData: MarginData = { available: false, reason: "Database not configured." };
  let topBottomData: TopBottomResult = { available: false, reason: "Database not configured." };
  let voidsData: VoidsResult = { available: false, reason: "Database not configured." };
  let combosData: CombosResult = { available: false, reason: "Database not configured." };
  let lastReportDate: string | null = null;

  try {
    const supabase = getSupabaseServerClient();
    [gallonTrend, storeGallons, marginData, topBottomData, voidsData, combosData, lastReportDate] =
      await Promise.all([
        getGallonTrend(supabase),
        getStoreGallonsMtd(supabase),
        getMarginStatus(supabase),
        getTopBottomProducts(supabase),
        getVoids(supabase),
        getCombos(supabase),
        getLastReportDate(supabase),
      ]);
  } catch {
    // DB not yet configured — page renders with empty states throughout
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
            <span className="hd-report">
              Last report: {fmtIsoDate(lastReportDate)}
            </span>
          )}
        </div>
      </header>

      {/* ── Gallon Trend ───────────────────────────────────────────────── */}
      <section className="sec">
        <h2 className="sec-label">Gallon Trend</h2>
        <div className="trend-row">
          <TrendCard period="MTD" label="Gallons" data={gallonTrend.mtd} />
          <TrendCard period="QTD" label="Gallons" data={gallonTrend.qtd} />
          <TrendCard period="YTD" label="Gallons" data={gallonTrend.ytd} />
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

      {/* ── Operations: stub panels ────────────────────────────────────── */}
      <section className="sec">
        <h2 className="sec-label">Operations</h2>
        <div className="stub-grid">
          <StubPanel
            title="Store Margin"
            sub="≥40% green · within 2% yellow · >2% off red"
            dotCount={3}
            reason={marginData.available ? "" : marginData.reason}
          />
          <StubPanel
            title="Voids &amp; No-Sales"
            sub="Per store, daily count"
            dotCount={4}
            reason={voidsData.available ? "" : voidsData.reason}
          />
          <StubPanel
            title="Top &amp; Bottom Items"
            sub="Best 5 sellers · Slowest 5 sellers"
            dotCount={5}
            reason={topBottomData.available ? "" : topBottomData.reason}
          />
          <StubPanel
            title="Meal Combos"
            sub="Breakfast pairings · Lunch pairings · Ranked by store"
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

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="foot">
        Data sourced from Taiga daily email reports &middot; Updated automatically each morning
      </footer>

    </main>
  );
}
