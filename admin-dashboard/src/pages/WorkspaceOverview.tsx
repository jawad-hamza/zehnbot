import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import { DailyColumns, RangePicker, StatTile, formatCompact, formatPercent } from "../components/charts";
import { IconArrowRight, IconBook, IconBot, IconChat, IconCheck, IconHelp, IconLead, IconPlus } from "../components/icons";

interface Overview {
  days: number;
  workspace: { name: string; plan: string; monthly_message_quota: number; platform_messages_this_month: number; messages_this_month: number; max_bots: number; bots_used: number };
  period: { conversations: number; visitor_messages: number; leads: number; unanswered: number; answer_rate: number; lead_conversion_rate: number };
  daily: { date: string; conversations: number; visitor_messages: number; leads: number }[];
  bots: { id: string; name: string; client_id: string; domain: string; is_active: boolean; uses_own_key: boolean; knowledge_chunks: number; conversations: number; leads: number }[];
  recent_leads: { id: string; name: string | null; email: string | null; phone: string | null; bot_id: string; bot_name: string; captured_at: string }[];
  open_questions: { question: string; bot_id: string; bot_name: string; asked_at: string }[];
  checklist: { has_bot: boolean; has_knowledge: boolean; has_conversation: boolean; has_lead: boolean };
}

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** A customer's home: what happened on their sites, what needs their attention, what to do next. */
export default function WorkspaceOverview() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.get("/admin/overview/workspace", { params: { days } })
      .then((r) => { if (current) { setData(r.data); setError(""); } })
      .catch((e) => { if (current) setError(errorDetail(e, "Could not load your overview.")); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [days]);

  if (error) return <div className="zb-alert zb-alert--danger" role="alert">{error}</div>;
  if (!data) return <OverviewSkeleton />;

  const { workspace, period, checklist, bots } = data;
  const firstBot = bots[0];
  const steps = [
    { done: checklist.has_bot, title: "Create your bot", text: "Name it and tell it which website it lives on.", to: "/bots/new", cta: "Create bot" },
    { done: checklist.has_knowledge, title: "Teach it your content", text: "Crawl your site, import pages, or upload PDFs. It only answers from what you give it.", to: firstBot ? `/bots/${firstBot.id}/knowledge` : "/bots", cta: "Add knowledge" },
    { done: checklist.has_conversation, title: "Try it, then put it on your site", text: "Open the preview, ask it a few questions, then paste one line into your website.", to: firstBot ? `/bots/${firstBot.id}/edit` : "/bots", cta: "Get embed code" },
    { done: checklist.has_lead, title: "Get your first lead", text: "When a visitor leaves an email or phone number, it shows up here and under Leads.", to: firstBot ? `/bots/${firstBot.id}/leads` : "/bots", cta: "Open leads" },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  const canAddBot = workspace.bots_used < workspace.max_bots;

  return (
    <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
      <div className="zb-page-head">
        <div>
          <h1>Overview</h1>
          <p>What your bots did across your sites, and what needs you.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <RangePicker days={days} onChange={setDays} />
          {canAddBot && <Link to="/bots/new" className="zb-btn zb-btn--primary"><IconPlus /> New bot</Link>}
        </div>
      </div>

      {remaining > 0 && (
        <section className="zb-card zb-card--pad" style={{ marginBottom: 14 }} aria-labelledby="setup-title">
          <h2 className="zb-card-title" id="setup-title">Get your bot live</h2>
          <p className="zb-card-sub">{remaining === steps.length ? "Four steps to a bot answering on your site." : `${steps.length - remaining} of ${steps.length} done.`}</p>
          <div style={{ marginTop: 8 }}>
            {steps.map((step, i) => {
              const isNext = !step.done && steps.slice(0, i).every((s) => s.done);
              return (
                <div key={step.title} className={`zb-check${step.done ? " done" : ""}`}>
                  <span className="zb-check-mark"><IconCheck size={14} /></span>
                  <div className="zb-check-text" style={{ flex: 1 }}>
                    <strong>{step.title}</strong>
                    {!step.done && <span>{step.text}</span>}
                  </div>
                  {isNext && <Link to={step.to} className="zb-btn zb-btn--secondary zb-btn--sm">{step.cta} <IconArrowRight size={14} /></Link>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="zb-grid zb-grid--stats" style={{ marginBottom: 14 }}>
        <StatTile icon={<IconChat size={16} />} label="Conversations" value={formatCompact(period.conversations)} note={`${formatCompact(period.visitor_messages)} visitor messages`} />
        <StatTile icon={<IconLead size={16} />} label="Leads captured" value={formatCompact(period.leads)} note={`${formatPercent(period.lead_conversion_rate)} of conversations`} />
        <StatTile icon={<IconHelp size={16} />} label="Questions answered" value={formatPercent(period.answer_rate)} note={period.unanswered ? `${period.unanswered} it could not answer` : "nothing left unanswered"} />
        <StatTile icon={<IconBot size={16} />} label="Messages this month" value={formatCompact(workspace.messages_this_month)} note={`${workspace.platform_messages_this_month.toLocaleString()} of ${workspace.monthly_message_quota.toLocaleString()} on your plan`} />
      </div>

      <div className="zb-grid zb-grid--2" style={{ marginBottom: 14 }}>
        <DailyColumns title="Conversations per day" unit="conversations" daily={data.daily} pick={(d) => d.conversations} />
        <DailyColumns title="Leads per day" unit="leads" daily={data.daily} pick={(d) => d.leads} />
      </div>

      <div className="zb-grid zb-grid--main">
        <section className="zb-card zb-card--pad" aria-labelledby="bots-title">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <h2 className="zb-card-title" id="bots-title">Your bots</h2>
            <Link to="/bots" style={{ fontSize: 13 }}>Manage bots</Link>
          </div>
          {bots.length === 0 ? (
            <p className="zb-empty">No bots yet. <Link to="/bots/new">Create your first one</Link>.</p>
          ) : (
            <div className="zb-table-wrap" style={{ marginTop: 8 }}>
              <table className="zb-table">
                <thead><tr><th>Bot</th><th className="zb-num">Knowledge</th><th className="zb-num">Conversations</th><th className="zb-num">Leads</th><th>Status</th></tr></thead>
                <tbody>
                  {bots.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <Link to={`/bots/${b.id}/insights`} style={{ fontWeight: 600, textDecoration: "none", color: "var(--fg)" }}>{b.name}</Link>
                        <div style={{ fontSize: 12.5, color: "var(--subtle-fg)" }}>{b.domain}</div>
                      </td>
                      <td className="zb-num">{b.knowledge_chunks ? b.knowledge_chunks.toLocaleString() : <Link to={`/bots/${b.id}/knowledge`}>Add</Link>}</td>
                      <td className="zb-num">{b.conversations.toLocaleString()}</td>
                      <td className="zb-num">{b.leads.toLocaleString()}</td>
                      <td><span className={`zb-badge ${b.is_active ? "zb-badge--success" : "zb-badge--neutral"}`}>{b.is_active ? "Live" : "Paused"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="zb-grid">
          <section className="zb-card zb-card--pad" aria-labelledby="leads-title">
            <h2 className="zb-card-title" id="leads-title">Recent leads</h2>
            {data.recent_leads.length === 0 ? (
              <p className="zb-empty">No leads yet. They appear as soon as a visitor leaves an email or phone number.</p>
            ) : (
              <ul className="zb-list">
                {data.recent_leads.map((l) => (
                  <li key={l.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name || l.email || l.phone}</div>
                      <div style={{ fontSize: 12.5, color: "var(--subtle-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[l.name ? l.email : null, l.phone, l.bot_name].filter(Boolean).join(", ")}
                      </div>
                    </div>
                    <Link to={`/bots/${l.bot_id}/leads`} style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{when(l.captured_at)}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="zb-card zb-card--pad" aria-labelledby="gaps-title">
            <h2 className="zb-card-title" id="gaps-title">Questions it could not answer</h2>
            <p className="zb-card-sub">Each one is something to add to its knowledge.</p>
            {data.open_questions.length === 0 ? (
              <p className="zb-empty">None in this period.</p>
            ) : (
              <ul className="zb-list" style={{ marginTop: 4 }}>
                {data.open_questions.map((q, i) => (
                  <li key={i} style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{q.question}</div>
                    <Link to={`/bots/${q.bot_id}/knowledge`} className="zb-btn zb-btn--ghost zb-btn--sm" title={`Add knowledge to ${q.bot_name}`}><IconBook size={14} /> Add</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading overview">
      <div className="zb-skeleton" style={{ height: 34, width: 200, marginBottom: 22 }} />
      <div className="zb-grid zb-grid--stats" style={{ marginBottom: 14 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="zb-skeleton" style={{ height: 118 }} />)}
      </div>
      <div className="zb-grid zb-grid--2">
        {[0, 1].map((i) => <div key={i} className="zb-skeleton" style={{ height: 290 }} />)}
      </div>
    </div>
  );
}
