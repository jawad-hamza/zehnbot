import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import { DailyColumns, RangePicker, StatTile, formatCompact } from "../components/charts";
import { IconAlert, IconBot, IconChat, IconLead, IconPlus, IconUsers, IconZap } from "../components/icons";
import { OverviewSkeleton } from "./WorkspaceOverview";

interface Platform {
  days: number;
  totals: { tenants: number; active_tenants: number; suspended_tenants: number; bots: number; active_bots: number; users: number; tenants_near_quota: number; new_enquiries: number };
  period: { new_tenants: number; conversations: number; visitor_messages: number; leads: number };
  month: { messages: number; platform_messages: number; tokens: number };
  daily: { date: string; signups: number; conversations: number; visitor_messages: number; leads: number }[];
  plans: { plan: string; tenants: number }[];
  top_tenants: { id: string; name: string; plan: string; is_active: boolean; bots: number; messages_this_month: number; platform_messages_this_month: number; monthly_message_quota: number }[];
  recent_tenants: { id: string; name: string; plan: string; is_active: boolean; owner_email: string | null; created_at: string }[];
  system: { environment: string; platform_provider: string; platform_model: string | null; platform_key_set: boolean; semantic_search: boolean; signup_open: boolean; signup_wanted: boolean; email_verification: boolean; unverified_signup_allowed: boolean; google_sign_in: boolean; custom_endpoints_allowed: boolean };
}

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Flag({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return <span className={`zb-badge ${ok ? "zb-badge--success" : "zb-badge--neutral"}`}>{ok ? on : off}</span>;
}

/** The operator's home: is the platform healthy, is it growing, who is using it, who needs attention. */
export default function PlatformOverview() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Platform | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.get("/admin/overview/platform", { params: { days } })
      .then((r) => { if (current) { setData(r.data); setError(""); } })
      .catch((e) => { if (current) setError(errorDetail(e, "Could not load the platform overview.")); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [days]);

  if (error) return <div className="zb-alert zb-alert--danger" role="alert">{error}</div>;
  if (!data) return <OverviewSkeleton />;

  const { totals, period, month, system } = data;
  const busiestPlan = Math.max(1, ...data.plans.map((p) => p.tenants));

  return (
    <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
      <div className="zb-page-head">
        <div>
          <h1>Platform overview</h1>
          <p>Every workspace on this installation.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <RangePicker days={days} onChange={setDays} />
          <Link to="/tenants" className="zb-btn zb-btn--primary"><IconPlus /> New tenant</Link>
        </div>
      </div>

      {!system.platform_key_set && (
        <div className="zb-alert zb-alert--danger" role="alert" style={{ marginBottom: 14, display: "flex", gap: 10 }}>
          <IconAlert size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>No platform AI key is configured. Bots without a key of their own cannot answer. Set <code>PLATFORM_AI_API_KEY</code> in <code>.env</code> and restart.</span>
        </div>
      )}
      {system.signup_wanted && !system.email_verification && !system.unverified_signup_allowed && (
        <div className="zb-alert zb-alert--info" role="status" style={{ marginBottom: 14 }}>
          Sign-up is switched on, but it stays closed until the platform can send email: without a confirmation link, anyone could register with a fake address.
          Add SMTP_HOST, SMTP_FROM, SMTP_USERNAME and SMTP_PASSWORD to .env, restart the backend, and check them with: docker compose exec backend python scripts/send_test_email.py you@example.com.
          {system.google_sign_in ? " Sign in with Google already works, because Google confirms the address." : " Until then, visitors who press Start free are offered the contact form, which lands in Enquiries."}
        </div>
      )}
      {system.signup_wanted && system.unverified_signup_allowed && !system.email_verification && (
        <div className="zb-alert zb-alert--danger" role="alert" style={{ marginBottom: 14 }}>
          ALLOW_UNVERIFIED_SIGNUP is on and there is no mail server: anyone can register with any email address, real or not. Fine on your own computer, never on a public server.
        </div>
      )}
      {totals.new_enquiries > 0 && (
        <div className="zb-alert zb-alert--info" role="status" style={{ marginBottom: 14 }}>
          {totals.new_enquiries} {totals.new_enquiries === 1 ? "person is" : "people are"} waiting for a reply from Talk to Zehnox. <Link to="/enquiries">Open enquiries</Link>
        </div>
      )}
      {totals.tenants_near_quota > 0 && (
        <div className="zb-alert zb-alert--info" style={{ marginBottom: 14 }}>
          {totals.tenants_near_quota} workspace{totals.tenants_near_quota === 1 ? " has" : "s have"} used 80% or more of this month's message quota. They are listed first below.
        </div>
      )}

      <div className="zb-grid zb-grid--stats" style={{ marginBottom: 14 }}>
        <StatTile icon={<IconUsers size={16} />} label="Workspaces" value={formatCompact(totals.tenants)} note={`${totals.active_tenants} active, ${totals.suspended_tenants} suspended, ${period.new_tenants} new`} />
        <StatTile icon={<IconBot size={16} />} label="Bots" value={formatCompact(totals.bots)} note={`${totals.active_bots} live`} />
        <StatTile icon={<IconChat size={16} />} label="Conversations" value={formatCompact(period.conversations)} note={`${formatCompact(period.visitor_messages)} visitor messages`} />
        <StatTile icon={<IconLead size={16} />} label="Leads captured" value={formatCompact(period.leads)} note={`last ${data.days} days, all workspaces`} />
        <StatTile icon={<IconZap size={16} />} label="Messages this month" value={formatCompact(month.messages)} note={`${formatCompact(month.platform_messages)} on your AI key, ${formatCompact(month.tokens)} tokens`} />
      </div>

      <div className="zb-grid zb-grid--2" style={{ marginBottom: 14 }}>
        <DailyColumns title="Sign-ups per day" unit="new workspaces" daily={data.daily} pick={(d) => d.signups} />
        <DailyColumns title="Conversations per day" unit="conversations" daily={data.daily} pick={(d) => d.conversations} />
      </div>

      <div className="zb-grid zb-grid--main">
        <section className="zb-card zb-card--pad" aria-labelledby="usage-title">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <h2 className="zb-card-title" id="usage-title">Busiest workspaces this month</h2>
            <Link to="/tenants" style={{ fontSize: 13 }}>All tenants</Link>
          </div>
          {data.top_tenants.length === 0 ? (
            <p className="zb-empty">No workspaces yet. <Link to="/tenants">Create the first one</Link>, or open sign-up.</p>
          ) : (
            <div className="zb-table-wrap" style={{ marginTop: 8 }}>
              <table className="zb-table">
                <thead><tr><th>Workspace</th><th>Plan</th><th className="zb-num">Bots</th><th className="zb-num">Messages</th><th style={{ minWidth: 150 }}>Quota on your key</th></tr></thead>
                <tbody>
                  {data.top_tenants.map((t) => {
                    const share = t.monthly_message_quota ? t.platform_messages_this_month / t.monthly_message_quota : 0;
                    const meter = share >= 1 ? "zb-meter zb-meter--danger" : share >= 0.8 ? "zb-meter zb-meter--warn" : "zb-meter";
                    return (
                      <tr key={t.id}>
                        <td>
                          <span style={{ fontWeight: 600 }}>{t.name}</span>
                          {!t.is_active && <span className="zb-badge zb-badge--danger" style={{ marginLeft: 8 }}>Suspended</span>}
                        </td>
                        <td><span className="zb-badge zb-badge--neutral" style={{ textTransform: "capitalize" }}>{t.plan}</span></td>
                        <td className="zb-num">{t.bots}</td>
                        <td className="zb-num">{t.messages_this_month.toLocaleString()}</td>
                        <td>
                          <div style={{ fontSize: 12.5, color: "var(--muted-fg)", fontVariantNumeric: "tabular-nums" }}>
                            {t.platform_messages_this_month.toLocaleString()} of {t.monthly_message_quota.toLocaleString()}
                          </div>
                          <div className={meter} style={{ marginTop: 4 }}><span style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} /></div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="zb-grid">
          <section className="zb-card zb-card--pad" aria-labelledby="system-title">
            <h2 className="zb-card-title" id="system-title">System</h2>
            <div style={{ marginTop: 6 }}>
              <div className="zb-status-row"><span>Platform AI</span><strong style={{ fontWeight: 600, textAlign: "right" }}>{system.platform_provider}{system.platform_model ? `, ${system.platform_model}` : ""}</strong></div>
              <div className="zb-status-row"><span>Platform AI key</span><Flag ok={system.platform_key_set} on="Configured" off="Missing" /></div>
              <div className="zb-status-row"><span>Semantic search</span><Flag ok={system.semantic_search} on="On" off="Keyword only" /></div>
              <div className="zb-status-row"><span>Public sign-up</span><Flag ok={system.signup_open} on="Open" off={system.signup_wanted ? "Closed, needs email" : "Closed"} /></div>
              <div className="zb-status-row"><span>Email verification</span><Flag ok={system.email_verification} on="On" off="No mail server" /></div>
              <div className="zb-status-row"><span>Sign in with Google</span><Flag ok={system.google_sign_in} on="On" off="Not set up" /></div>
              <div className="zb-status-row"><span>Custom AI endpoints</span><Flag ok={system.custom_endpoints_allowed} on="Allowed" off="Off" /></div>
              <div className="zb-status-row"><span>Environment</span><span style={{ textTransform: "capitalize" }}>{system.environment}</span></div>
            </div>
          </section>

          <section className="zb-card zb-card--pad" aria-labelledby="plans-title">
            <h2 className="zb-card-title" id="plans-title">Workspaces by plan</h2>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              {data.plans.map((p) => (
                <div key={p.plan} style={{ display: "grid", gridTemplateColumns: "76px 1fr 32px", alignItems: "center", gap: 10, fontSize: 13.5 }}>
                  <span style={{ textTransform: "capitalize", color: "var(--muted-fg)" }}>{p.plan}</span>
                  {/* a bare bar, no filled track: only the counted part is drawn */}
                  <span style={{ height: 8, borderRadius: 4, width: `${Math.max(p.tenants ? 4 : 0, (p.tenants / busiestPlan) * 100)}%`, background: "var(--series)" }} />
                  <span className="zb-num" style={{ fontVariantNumeric: "tabular-nums" }}>{p.tenants}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="zb-card zb-card--pad" aria-labelledby="new-title">
            <h2 className="zb-card-title" id="new-title">Newest workspaces</h2>
            {data.recent_tenants.length === 0 ? (
              <p className="zb-empty">None yet.</p>
            ) : (
              <ul className="zb-list">
                {data.recent_tenants.map((t) => (
                  <li key={t.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                      <div style={{ fontSize: 12.5, color: "var(--subtle-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.owner_email ?? "no login yet"}</div>
                    </div>
                    <span style={{ fontSize: 12.5, color: "var(--subtle-fg)", whiteSpace: "nowrap" }}>{when(t.created_at)}</span>
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
