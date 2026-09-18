import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import type { Analytics, DailyActivity } from "../types";

// Chart ink. One series per chart, so one validated hue; everything textual stays in text tokens.
const SERIES = "#2a78d6";
const SERIES_HOVER = "#1f5fae";
const INK = "#1e293b";
const INK_SECONDARY = "#64748b";
const INK_MUTED = "#94a3b8";
const GRID = "#e8edf3";

const RANGES = [7, 30, 90];

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px" };

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const percent = (v: number) => `${Math.round(v * 100)}%`;
const shortDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export default function AnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.get(`/admin/clients/${id}/analytics`, { params: { days } })
      .then((r) => { if (current) { setData(r.data); setError(""); } })
      .catch((e) => { if (current) setError(errorDetail(e, "Could not load insights.")); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [id, days]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <Link to="/clients" style={{ color: INK_SECONDARY, textDecoration: "none", fontSize: 14 }}>← Bots</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Insights</h1>
      </div>

      {/* One filter row, above everything it scopes */}
      <div role="group" aria-label="Date range" style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={days === r}
            onClick={() => setDays(r)}
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              border: `1px solid ${days === r ? INK : "#cbd5e1"}`,
              background: days === r ? INK : "#fff",
              color: days === r ? "#fff" : INK_SECONDARY,
            }}
          >
            Last {r} days
          </button>
        ))}
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 16 }}>{error}</p>}
      {!data && loading && <p style={{ color: INK_SECONDARY }}>Loading…</p>}

      {data && (
        // While a new range loads the previous render stays in place, dimmed: no skeleton, no layout jump
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 0.15s" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
            <StatTile label="Conversations" value={compact.format(data.conversations)} note={`${compact.format(data.visitor_messages)} visitor messages`} />
            <StatTile label="Leads captured" value={compact.format(data.leads)} note={`${percent(data.lead_conversion_rate)} of conversations`} />
            <StatTile label="Questions answered" value={percent(data.answer_rate)} note={data.unanswered ? `${data.unanswered} could not be answered` : "nothing left unanswered"} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12, marginBottom: 16 }}>
            <DailyColumns title="Conversations per day" unit="conversations" daily={data.daily} pick={(d) => d.conversations} />
            <DailyColumns title="Leads per day" unit="leads" daily={data.daily} pick={(d) => d.leads} />
          </div>

          <div style={card}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: INK }}>Questions your bot couldn't answer</h2>
            <p style={{ fontSize: 12, color: INK_SECONDARY, margin: "4px 0 14px" }}>
              Each one is a gap in the knowledge base. Add the answer under <Link to={`/clients/${id}/knowledge`} style={{ color: SERIES_HOVER }}>Knowledge</Link> and the bot will handle it next time.
            </p>
            {data.unanswered_questions.length === 0 ? (
              <p style={{ fontSize: 13, color: INK_SECONDARY }}>None in this period.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {data.unanswered_questions.map((q, i) => (
                    <tr key={i} style={{ borderTop: i ? "1px solid #f1f5f9" : "none" }}>
                      <td style={{ padding: "9px 12px 9px 0", fontSize: 13, color: INK, overflowWrap: "anywhere" }}>{q.question}</td>
                      <td style={{ padding: "9px 0", fontSize: 12, color: INK_MUTED, whiteSpace: "nowrap", textAlign: "right", verticalAlign: "top" }}>
                        {new Date(q.asked_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p style={{ fontSize: 11, color: INK_MUTED, marginTop: 10 }}>Days are counted in UTC.</p>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 12, color: INK_SECONDARY }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color: INK, margin: "4px 0 2px", lineHeight: 1.15 }}>{value}</div>
      <div style={{ fontSize: 12, color: INK_MUTED }}>{note}</div>
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

/** Single-series daily columns: no legend (the title names the series), hover/focus tooltip, table view. */
function DailyColumns({ title, unit, daily, pick }: { title: string; unit: string; daily: DailyActivity[]; pick: (d: DailyActivity) => number }) {
  const [active, setActive] = useState<number | null>(null);

  const values = daily.map(pick);
  const total = values.reduce((a, b) => a + b, 0);
  const ticks = niceTicks(Math.max(...values, 1));
  const top = ticks[ticks.length - 1];

  const plotW = W - LEFT - RIGHT, plotH = H - TOP - BOTTOM;
  const band = plotW / daily.length;
  const barW = Math.min(24, Math.max(2, band - 2));          // capped thickness; the rest of the band is air, and >=2px separates neighbours
  const y = (v: number) => TOP + plotH - (v / top) * plotH;
  // About six date labels, always including the latest day, and never two so close that they collide
  const labelEvery = Math.ceil(daily.length / 6);
  const last = daily.length - 1;
  const showDateLabel = (i: number) => i === last || (i % labelEvery === 0 && last - i >= labelEvery * 0.6);

  const column = (i: number, v: number) => {
    const x = LEFT + i * band + (band - barW) / 2;
    const h = (v / top) * plotH;
    const r = Math.min(4, barW / 2, h);                          // rounded data-end, square at the baseline
    const yTop = TOP + plotH - h;
    return `M${x},${TOP + plotH} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${TOP + plotH} Z`;
  };

  return (
    <div style={card}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</h2>
      <p style={{ fontSize: 12, color: INK_SECONDARY, margin: "2px 0 8px" }}>{compact.format(total)} {unit} in the last {daily.length} days</p>

      <div style={{ position: "relative" }} onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}: ${total} in the last ${daily.length} days. Use the table below for exact values.`} style={{ display: "block", overflow: "visible" }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={LEFT - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill={INK_MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>{compact.format(t)}</text>
            </g>
          ))}
          <line x1={LEFT} x2={W - RIGHT} y1={TOP + plotH} y2={TOP + plotH} stroke="#cbd5e1" strokeWidth={1} />

          {daily.map((d, i) => (
            <g key={d.date}>
              {values[i] > 0 && <path d={column(i, values[i])} fill={active === i ? SERIES_HOVER : SERIES} />}
              {showDateLabel(i) && (
                <text x={LEFT + i * band + band / 2} y={H - 7} textAnchor={i === daily.length - 1 ? "end" : "middle"} fontSize={10.5} fill={INK_MUTED}>{shortDate(d.date)}</text>
              )}
              {/* the hit target is the whole day's band, not just the painted bar (zero days included) */}
              <rect
                x={LEFT + i * band} y={TOP} width={band} height={plotH + 4} fill="transparent" tabIndex={0}
                aria-label={`${shortDate(d.date)}: ${values[i]} ${unit}`}
                onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                style={{ outline: "none", cursor: "default" }}
              />
            </g>
          ))}
        </svg>

        {active !== null && (
          <div
            role="status"
            style={{
              position: "absolute", pointerEvents: "none", top: 0,
              left: `${((LEFT + active * band + band / 2) / W) * 100}%`,
              transform: `translateX(${active > daily.length * 0.7 ? "-100%" : active < daily.length * 0.3 ? "0" : "-50%"})`,
              background: INK, color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
            }}
          >
            {/* value leads, label follows */}
            <strong style={{ fontSize: 14 }}>{values[active].toLocaleString()}</strong> <span style={{ opacity: 0.75 }}>{unit}</span>
            <div style={{ opacity: 0.75 }}>{shortDate(daily[active].date)}</div>
          </div>
        )}
      </div>

      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 12, color: INK_SECONDARY, cursor: "pointer" }}>Show as table</summary>
        <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ textAlign: "left", color: INK_SECONDARY }}><th style={{ padding: "4px 0", fontWeight: 600 }}>Day</th><th style={{ padding: "4px 0", fontWeight: 600, textAlign: "right" }}>{title.replace(" per day", "")}</th></tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.date} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "4px 0", color: INK }}>{shortDate(d.date)}</td>
                  <td style={{ padding: "4px 0", color: INK, textAlign: "right" }}>{pick(d).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
