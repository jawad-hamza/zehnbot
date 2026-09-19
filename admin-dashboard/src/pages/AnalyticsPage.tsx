import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import { DailyColumns, RangePicker, StatTile, formatCompact, formatPercent } from "../components/charts";
import { IconChat, IconHelp, IconLead } from "../components/icons";
import type { Analytics } from "../types";

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
      <div className="zb-page-head">
        <div>
          <Link to="/bots" style={{ fontSize: 13, textDecoration: "none" }}>Back to bots</Link>
          <h1 style={{ marginTop: 4 }}>Insights</h1>
        </div>
        {/* one filter row, above everything it scopes */}
        <RangePicker days={days} onChange={setDays} />
      </div>

      {error && <div className="zb-alert zb-alert--danger" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
      {!data && loading && <p style={{ color: "var(--muted-fg)" }}>Loading…</p>}

      {data && (
        // While a new range loads the previous render stays in place, dimmed: no skeleton, no layout jump
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 0.15s" }}>
          <div className="zb-grid zb-grid--stats" style={{ marginBottom: 14 }}>
            <StatTile icon={<IconChat size={16} />} label="Conversations" value={formatCompact(data.conversations)} note={`${formatCompact(data.visitor_messages)} visitor messages`} />
            <StatTile icon={<IconLead size={16} />} label="Leads captured" value={formatCompact(data.leads)} note={`${formatPercent(data.lead_conversion_rate)} of conversations`} />
            <StatTile icon={<IconHelp size={16} />} label="Questions answered" value={formatPercent(data.answer_rate)} note={data.unanswered ? `${data.unanswered} could not be answered` : "nothing left unanswered"} />
          </div>

          <div className="zb-grid zb-grid--2" style={{ marginBottom: 14 }}>
            <DailyColumns title="Conversations per day" unit="conversations" daily={data.daily} pick={(d) => d.conversations} />
            <DailyColumns title="Leads per day" unit="leads" daily={data.daily} pick={(d) => d.leads} />
          </div>

          <section className="zb-card zb-card--pad" aria-labelledby="gaps-title">
            <h2 className="zb-card-title" id="gaps-title">Questions your bot couldn't answer</h2>
            <p className="zb-card-sub" style={{ marginBottom: 10 }}>
              Each one is a gap in the knowledge base. Add the answer under <Link to={`/bots/${id}/knowledge`}>Knowledge</Link> and the bot will handle it next time.
            </p>
            {data.unanswered_questions.length === 0 ? (
              <p className="zb-empty">None in this period.</p>
            ) : (
              <ul className="zb-list">
                {data.unanswered_questions.map((q, i) => (
                  <li key={i} style={{ alignItems: "flex-start" }}>
                    <span style={{ flex: 1, overflowWrap: "anywhere" }}>{q.question}</span>
                    <span style={{ fontSize: 12.5, color: "var(--subtle-fg)", whiteSpace: "nowrap" }}>
                      {new Date(q.asked_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p style={{ fontSize: 12, color: "var(--subtle-fg)", marginTop: 10 }}>Days are counted in UTC.</p>
        </div>
      )}
    </div>
  );
}
