import { useCallback, useEffect, useState } from "react";
import { api, errorDetail } from "../api/client";
import { IconInbox, IconSearch } from "../components/icons";
import { useAuthStore } from "../store/authStore";

type Status = "new" | "contacted" | "closed";

interface Enquiry {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  plan: string | null;
  message: string | null;
  source: string;
  status: Status;
  created_at: string;
}

const FILTERS: { value: Status | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "closed", label: "Closed" },
];
const BADGE: Record<Status, string> = { new: "zb-badge--primary", contacted: "zb-badge--warning", closed: "zb-badge--neutral" };
const SOURCES: Record<string, string> = {
  "landing-pricing": "Pricing, landing page",
  "landing-done-for-you": "Done for you, landing page",
  "landing-footer": "Footer, landing page",
  "signup-closed": "Sign-up page (closed)",
  "settings-plan": "A customer's settings (plan change)",
  landing: "Landing page",
};

/** Super admin only. People who pressed "Talk to Zehnox": the platform's own leads. */
export default function EnquiriesPage() {
  const token = useAuthStore((s) => s.token);
  const [items, setItems] = useState<Enquiry[] | null>(null);
  const [counts, setCounts] = useState({ total: 0, fresh: 0 });
  const [status, setStatus] = useState<Status | "">("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.get("/admin/enquiries", { params: { status: status || undefined, q: q.trim() || undefined } })
      .then((r) => { setItems(r.data.items); setCounts({ total: r.data.total, fresh: r.data.new }); setError(""); })
      .catch((err: unknown) => setError(errorDetail(err, "Could not load the enquiries.")));
  }, [status, q]);

  useEffect(() => {
    const timer = setTimeout(load, q ? 250 : 0);     // typing in the search box does not fire a request per key
    return () => clearTimeout(timer);
  }, [load, q]);

  async function move(item: Enquiry, next: Status) {
    try {
      await api.patch(`/admin/enquiries/${item.id}`, { status: next });
      load();
    } catch (err: unknown) {
      setError(errorDetail(err, "Could not update that enquiry."));
    }
  }

  async function remove(item: Enquiry) {
    if (!window.confirm(`Delete the enquiry from ${item.name || item.email || item.phone}? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/enquiries/${item.id}`);
      load();
    } catch (err: unknown) {
      setError(errorDetail(err, "Could not delete that enquiry."));
    }
  }

  async function exportCsv() {
    // fetched with the session header, so the file never needs a token in its URL
    const res = await fetch("/api/admin/enquiries/export", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { setError("Could not export the enquiries."); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: "zehnbot-enquiries.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="zb-page-head">
        <div>
          <h1>Enquiries</h1>
          <p>People who pressed Talk to Zehnox. {counts.fresh > 0 ? `${counts.fresh} waiting for a reply.` : "Nobody is waiting for a reply."}</p>
        </div>
        <button type="button" className="zb-btn zb-btn--secondary" onClick={exportCsv} disabled={!items?.length}>Export CSV</button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <div className="zb-seg" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f.label} type="button" aria-pressed={status === f.value} className={status === f.value ? "active" : ""} onClick={() => setStatus(f.value)}>{f.label}</button>
          ))}
        </div>
        <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 360 }}>
          <IconSearch size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--subtle-fg)" }} />
          <label className="zb-sr-only" htmlFor="enquiry-search">Search enquiries</label>
          <input id="enquiry-search" className="zb-input" style={{ paddingLeft: 36 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, business or message" />
        </div>
      </div>

      {error && <div className="zb-alert zb-alert--danger" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {items === null ? (
        <div className="zb-card zb-card--pad"><div className="zb-skeleton" style={{ height: 120 }} /></div>
      ) : items.length === 0 ? (
        <div className="zb-card zb-empty">
          <span className="zb-stat-icon"><IconInbox size={22} /></span>
          <strong>{status || q ? "Nothing matches that filter." : "No enquiries yet."}</strong>
          <span>{status || q ? "Try another status, or clear the search." : "When someone presses Talk to Zehnox on the landing page, their details appear here."}</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((item) => (
            <article key={item.id} className="zb-card zb-card--pad">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <h2 className="zb-card-title" style={{ overflowWrap: "anywhere" }}>{item.name || "No name given"}</h2>
                    <span className={`zb-badge ${BADGE[item.status]}`} style={{ textTransform: "capitalize" }}>{item.status}</span>
                    {item.plan && <span className="zb-badge zb-badge--neutral">{item.plan} plan</span>}
                  </div>
                  <div style={{ display: "flex", gap: "4px 18px", flexWrap: "wrap", marginTop: 8, fontSize: 14 }}>
                    {item.email && <a href={`mailto:${item.email}`} style={{ overflowWrap: "anywhere" }}>{item.email}</a>}
                    {item.phone && <a href={`tel:${item.phone.replace(/[^\d+]/g, "")}`}>{item.phone}</a>}
                    {item.company && <span style={{ color: "var(--muted-fg)", overflowWrap: "anywhere" }}>{item.company}</span>}
                  </div>
                </div>
                <div className="zb-help" style={{ textAlign: "right" }}>
                  <div>{new Date(item.created_at).toLocaleString()}</div>
                  <div>{SOURCES[item.source] ?? item.source}</div>
                </div>
              </div>
              {item.message && <p style={{ marginTop: 14, color: "var(--fg-2)", lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.message}</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                {item.status !== "contacted" && <button type="button" className="zb-btn zb-btn--secondary zb-btn--sm" onClick={() => move(item, "contacted")}>Mark as contacted</button>}
                {item.status !== "closed" && <button type="button" className="zb-btn zb-btn--secondary zb-btn--sm" onClick={() => move(item, "closed")}>Close</button>}
                {item.status !== "new" && <button type="button" className="zb-btn zb-btn--ghost zb-btn--sm" onClick={() => move(item, "new")}>Back to new</button>}
                <button type="button" className="zb-btn zb-btn--ghost zb-btn--sm" style={{ marginLeft: "auto", color: "var(--danger)" }} onClick={() => remove(item)}>Delete</button>
              </div>
            </article>
          ))}
          {counts.total > items.length && <p className="zb-help">Showing the newest {items.length} of {counts.total}. Narrow it down with the search, or export them all.</p>}
        </div>
      )}
    </div>
  );
}
