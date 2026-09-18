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
        <Link to="/clients" style={{ color: "#64748b", textDecoration: "none", fontSize: 14 }}>← Bots</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Leads ({total})</h1>
        {total > 0 && (
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting}
            style={{ marginLeft: "auto", background: "#fff", border: "1px solid #cbd5e1", color: "#1e293b", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: exporting ? 0.6 : 1 }}
          >
            {exporting ? "Preparing…" : "Export CSV"}
          </button>
        )}
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && leads.length === 0 && <p style={{ color: "#64748b" }}>Loading…</p>}
      {!loading && leads.length === 0 && <p style={{ color: "#64748b" }}>No leads captured yet.</p>}

      {leads.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0", opacity: loading ? 0.5 : 1 }}>
          <thead>
            <tr style={{ background: "#f8fafc", textAlign: "left" }}>
              {["Name", "Email", "Phone", "Via", "Captured At"].map((h) => (
                <th key={h} style={{ padding: "10px 16px", fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{l.name || "—"}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{l.email ? <a href={`mailto:${l.email}`} style={{ color: "#1d4ed8", textDecoration: "none" }}>{l.email}</a> : "—"}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{l.phone || "—"}</td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: "#64748b" }} title={l.source === "chat" ? "The visitor typed their details into the conversation" : "The visitor filled in the widget's contact form"}>
                  {l.source === "chat" ? "Typed in chat" : "Contact form"}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#64748b" }}>{new Date(l.captured_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, fontSize: 12, color: "#64748b" }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontFamily: "inherit" }}>Newer</button>
          <span>Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontFamily: "inherit" }}>Older</button>
        </div>
      )}
    </div>
  );
}
