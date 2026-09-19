import { useState, type ReactNode } from "react";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
export const formatCompact = (n: number) => compact.format(n);
export const formatPercent = (v: number) => `${Math.round(v * 100)}%`;
const shortDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export function StatTile({ label, value, note, icon }: { label: string; value: string; note?: string; icon?: ReactNode }) {
  return (
    <div className="zb-card zb-card--pad">
      <div className="zb-stat-label">
        {icon && <span className="zb-stat-icon">{icon}</span>}
        {label}
      </div>
      <div className="zb-stat-value">{value}</div>
      {note && <div className="zb-stat-note">{note}</div>}
    </div>
  );
}

/** Round the axis top up to a clean number and return 3 evenly spaced ticks above zero. */
function niceTicks(max: number): number[] {
  if (max <= 3) return [1, 2, 3].slice(0, Math.max(1, max));
  const rough = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  return [step, step * 2, step * 3];
}

const W = 560, H = 190, LEFT = 34, RIGHT = 8, TOP = 12, BOTTOM = 24;

interface DailyProps<T extends { date: string }> {
  title: string;
  unit: string;
  daily: T[];
  pick: (d: T) => number;
}

/** Single-series daily columns. One series, so no legend: the title names it. Hover and keyboard
 *  focus show the exact value; "Show as table" gives every value without hovering at all. */
export function DailyColumns<T extends { date: string }>({ title, unit, daily, pick }: DailyProps<T>) {
  const [active, setActive] = useState<number | null>(null);

  const values = daily.map(pick);
  const total = values.reduce((a, b) => a + b, 0);
  const ticks = niceTicks(Math.max(...values, 1));
  const top = ticks[ticks.length - 1];

  const plotW = W - LEFT - RIGHT, plotH = H - TOP - BOTTOM;
  const band = plotW / Math.max(1, daily.length);
  const barW = Math.min(24, Math.max(2, band - 2)); // capped thickness; >=2px of surface separates neighbours
  const y = (v: number) => TOP + plotH - (v / top) * plotH;
  // About six date labels, always including the latest day, never two close enough to collide
  const labelEvery = Math.ceil(daily.length / 6);
  const last = daily.length - 1;
  const showDateLabel = (i: number) => i === last || (i % labelEvery === 0 && last - i >= labelEvery * 0.6);

  const column = (i: number, v: number) => {
    const x = LEFT + i * band + (band - barW) / 2;
    const h = (v / top) * plotH;
    const r = Math.min(4, barW / 2, h); // rounded data-end, square at the baseline
    const yTop = TOP + plotH - h;
    return `M${x},${TOP + plotH} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${TOP + plotH} Z`;
  };

  return (
    <div className="zb-card zb-card--pad">
      <h2 className="zb-card-title">{title}</h2>
      <p className="zb-card-sub" style={{ marginBottom: 8 }}>{compact.format(total)} {unit} in the last {daily.length} days</p>

      <div style={{ position: "relative" }} onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
          aria-label={`${title}: ${total} in the last ${daily.length} days. Use the table below for exact values.`}
          style={{ display: "block", overflow: "visible" }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} style={{ stroke: "var(--grid)" }} strokeWidth={1} />
              <text x={LEFT - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} style={{ fill: "var(--subtle-fg)", fontVariantNumeric: "tabular-nums" }}>{compact.format(t)}</text>
            </g>
          ))}
          <line x1={LEFT} x2={W - RIGHT} y1={TOP + plotH} y2={TOP + plotH} style={{ stroke: "var(--border-strong)" }} strokeWidth={1} />

          {daily.map((d, i) => (
            <g key={d.date}>
              {values[i] > 0 && <path d={column(i, values[i])} style={{ fill: active === i ? "var(--series-hover)" : "var(--series)", transition: "fill 0.12s ease" }} />}
              {showDateLabel(i) && (
                <text x={LEFT + i * band + band / 2} y={H - 7} textAnchor={i === last ? "end" : "middle"} fontSize={10.5} style={{ fill: "var(--subtle-fg)" }}>{shortDate(d.date)}</text>
              )}
              {/* the hit target is the whole day's band, not just the painted bar (zero days included) */}
              <rect x={LEFT + i * band} y={TOP} width={band} height={plotH + 4} fill="transparent" tabIndex={0}
                aria-label={`${shortDate(d.date)}: ${values[i]} ${unit}`}
                onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                style={{ outline: "none", cursor: "default" }} />
            </g>
          ))}
        </svg>

        {active !== null && (
          <div role="status" style={{
            position: "absolute", pointerEvents: "none", top: 0,
            left: `${((LEFT + active * band + band / 2) / W) * 100}%`,
            transform: `translateX(${active > daily.length * 0.7 ? "-100%" : active < daily.length * 0.3 ? "0" : "-50%"})`,
            background: "var(--tooltip-bg)", color: "var(--tooltip-fg)", borderRadius: 10, padding: "6px 10px",
            fontSize: 12, whiteSpace: "nowrap", boxShadow: "var(--shadow-md)",
          }}>
            {/* value leads, label follows */}
            <strong style={{ fontSize: 14 }}>{values[active].toLocaleString()}</strong> <span style={{ opacity: 0.75 }}>{unit}</span>
            <div style={{ opacity: 0.75 }}>{shortDate(daily[active].date)}</div>
          </div>
        )}
      </div>

      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 12, color: "var(--muted-fg)" }}>Show as table</summary>
        <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 8 }}>
          <table className="zb-table" style={{ fontSize: 12 }}>
            <thead><tr><th>Day</th><th className="zb-num">{title.replace(" per day", "")}</th></tr></thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.date}><td>{shortDate(d.date)}</td><td className="zb-num">{pick(d).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function RangePicker({ days, onChange, options = [7, 30, 90] }: { days: number; onChange: (d: number) => void; options?: number[] }) {
  return (
    <div className="zb-seg" role="group" aria-label="Date range">
      {options.map((d) => (
        <button key={d} type="button" aria-pressed={days === d} onClick={() => onChange(d)}>Last {d} days</button>
      ))}
    </div>
  );
}
