import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import type { Lead } from "../types";

const PAGE_SIZE = 50;

export default function LeadsPage() {
  const { id } = useParams<{ id: string }>();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    api.get(`/admin/clients/${id}/leads`, { params: { page, page_size: PAGE_SIZE } }).then((r) => {
      setLeads(r.data.items);
      setTotal(r.data.total);
      setLoading(false);
    });
  }, [id, page]);

  // A plain <a href> cannot send the login token, so the file is fetched and handed to the browser
  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const res = await api.get(`/admin/clients/${id}/leads/export`, { responseType: "blob" });
      const name = /filename="([^"]+)"/.exec(res.headers["content-disposition"] ?? "")?.[1] ?? "leads.csv";
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorDetail(e, "Could not export leads."));
    } finally {
      setExporting(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <Link to="/bots" style={{ color: "var(--muted-fg)", textDecoration: "none", fontSize: 14 }}>← Bots</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Leads ({total})</h1>
        {total > 0 && (
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting}
            style={{ marginLeft: "auto", background: "var(--surface)", border: "1px solid var(--border-strong)", color: "var(--fg)", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: exporting ? 0.6 : 1 }}
          >
            {exporting ? "Preparing…" : "Export CSV"}
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && leads.length === 0 && <p style={{ color: "var(--muted-fg)" }}>Loading…</p>}
      {!loading && leads.length === 0 && <p style={{ color: "var(--muted-fg)" }}>No leads captured yet.</p>}

      {leads.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--surface)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", opacity: loading ? 0.5 : 1 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)", textAlign: "left" }}>
              {["Name", "Email", "Phone", "Via", "Captured At"].map((h) => (
                <th key={h} style={{ padding: "10px 16px", fontSize: 12, fontWeight: 700, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} style={{ borderTop: "1px solid var(--surface-3)" }}>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{l.name || "-"}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{l.email ? <a href={`mailto:${l.email}`} style={{ color: "var(--primary-text)", textDecoration: "none" }}>{l.email}</a> : "-"}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{l.phone || "-"}</td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--muted-fg)" }} title={l.source === "chat" ? "The visitor typed their details into the conversation" : "The visitor filled in the widget's contact form"}>
                  {l.source === "chat" ? "Typed in chat" : "Contact form"}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--muted-fg)" }}>{new Date(l.captured_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, fontSize: 12, color: "var(--muted-fg)" }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontFamily: "inherit" }}>Newer</button>
          <span>Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontFamily: "inherit" }}>Older</button>
        </div>
      )}
    </div>
  );
}
