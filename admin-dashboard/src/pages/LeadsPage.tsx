import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import type { Lead } from "../types";

export default function LeadsPage() {
  const { id } = useParams<{ id: string }>();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/admin/clients/${id}/leads`).then((r) => {
      setLeads(r.data.items);
      setTotal(r.data.total);
      setLoading(false);
    });
  }, [id]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <Link to="/clients" style={{ color: "#64748b", textDecoration: "none", fontSize: 14 }}>← Clients</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Leads ({total})</h1>
      </div>

      {loading && <p style={{ color: "#64748b" }}>Loading…</p>}
      {!loading && leads.length === 0 && <p style={{ color: "#64748b" }}>No leads captured yet.</p>}

      {leads.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0" }}>
          <thead>
            <tr style={{ background: "#f8fafc", textAlign: "left" }}>
              {["Name", "Email", "Phone", "Captured At"].map((h) => (
                <th key={h} style={{ padding: "10px 16px", fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{l.name || "—"}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{l.email || "—"}</td>
                <td style={{ padding: "12px 16px", fontSize: 14 }}>{l.phone || "—"}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#64748b" }}>{new Date(l.captured_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
