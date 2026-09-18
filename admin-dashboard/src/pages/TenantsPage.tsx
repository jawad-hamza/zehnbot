import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import { useAuthStore } from "../store/authStore";
import type { Plan, Tenant } from "../types";

const input: React.CSSProperties = { padding: "8px 11px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, outline: "none", fontFamily: "inherit" };
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#475569", display: "flex", flexDirection: "column", gap: 4 };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 22px", marginBottom: 12 };
const smallBtn = (bg: string, color: string): React.CSSProperties => ({ background: bg, color, border: "none", padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" });

/** Super admin only: the platform's customers, their plans, limits, usage and logins. */
export default function TenantsPage() {
  const me = useAuthStore((s) => s.me);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function refresh() {
    const [t, p] = await Promise.all([api.get("/admin/tenants"), api.get("/admin/plans")]);
    setTenants(t.data);
    setPlans(p.data);
    setLoading(false);
  }

  useEffect(() => {
    if (me?.role === "superadmin") refresh().catch((e) => { setError(errorDetail(e, "Could not load tenants.")); setLoading(false); });
  }, [me?.role]);

  if (me && me.role !== "superadmin") return <Navigate to="/clients" replace />;

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(errorDetail(e, fallback));
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Tenants</h1>
        <button onClick={() => setShowCreate((v) => !v)} style={{ ...smallBtn("#2563eb", "#fff"), padding: "9px 20px", fontSize: 14 }}>
          {showCreate ? "Cancel" : "+ New Tenant"}
        </button>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 16, whiteSpace: "pre-wrap" }}>{error}</p>}

      {showCreate && (
        <CreateTenantForm
          plans={plans}
          onCreate={(body) => run(async () => { await api.post("/admin/tenants", body); setShowCreate(false); }, "Could not create the tenant.")}
        />
      )}

      {loading && <p style={{ color: "#64748b" }}>Loading…</p>}
      {!loading && tenants.length === 0 && <p style={{ color: "#64748b" }}>No tenants yet. Create your first customer above.</p>}

      {tenants.map((t) => (
        <div key={t.id} style={{ ...card, opacity: t.is_active ? 1 : 0.65 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {t.name}
                <span style={{ marginLeft: 8, background: "#e0f2fe", color: "#0369a1", padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{t.plan}</span>
                {!t.is_active && <span style={{ marginLeft: 6, background: "#fee2e2", color: "#b91c1c", padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>SUSPENDED</span>}
              </div>
              <div style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>{t.users.map((u) => u.email).join(", ") || "no logins"}</div>
            </div>
            <Stat title="Bots" value={`${t.bots_used} / ${t.max_bots}`} />
            <Stat title="Platform messages (month)" value={`${t.platform_messages_this_month.toLocaleString()} / ${t.monthly_message_quota.toLocaleString()}`} warn={t.platform_messages_this_month >= t.monthly_message_quota} />
            <Stat title="All messages (month)" value={t.messages_this_month.toLocaleString()} />
            <div style={{ display: "flex", gap: 8 }}>
              <button style={smallBtn("#f1f5f9", "#1e293b")} onClick={() => setEditingId(editingId === t.id ? null : t.id)}>{editingId === t.id ? "Close" : "Manage"}</button>
              <button
                style={smallBtn(t.is_active ? "#fef3c7" : "#dcfce7", t.is_active ? "#92400e" : "#166534")}
                onClick={() => run(() => api.put(`/admin/tenants/${t.id}`, { is_active: !t.is_active }), "Could not update the tenant.")}
                title={t.is_active ? "Blocks the tenant's logins and switches its widgets off" : "Restore access"}
              >
                {t.is_active ? "Suspend" : "Reactivate"}
              </button>
            </div>
          </div>

          {editingId === t.id && (
            <ManageTenant
              tenant={t}
              plans={plans}
              onSave={(body) => run(() => api.put(`/admin/tenants/${t.id}`, body), "Could not update the tenant.")}
              onResetPassword={(userId, pw) => run(() => api.post(`/admin/tenants/${t.id}/users/${userId}/reset-password`, { new_password: pw }), "Could not reset the password.")}
              onAddUser={(email, pw) => run(() => api.post(`/admin/tenants/${t.id}/users`, { email, password: pw }), "Could not add the login.")}
              onDelete={() => {
                if (confirm(`Delete "${t.name}" with ALL of its bots, knowledge, conversations and leads? This cannot be undone.`)) {
                  run(() => api.delete(`/admin/tenants/${t.id}`), "Could not delete the tenant.");
                }
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ title, value, warn }: { title: string; value: string; warn?: boolean }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>{title}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: warn ? "#dc2626" : "#1e293b" }}>{value}</div>
    </div>
  );
}

function CreateTenantForm({ plans, onCreate }: { plans: Plan[]; onCreate: (body: object) => void }) {
  const [form, setForm] = useState({ name: "", plan: "free", owner_email: "", owner_password: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onCreate(form); }} style={{ ...card, background: "#f8fafc", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <label style={label}>Company name *<input style={input} value={form.name} onChange={set("name")} required minLength={2} placeholder="Acme Corp" /></label>
      <label style={label}>Plan
        <select style={input} value={form.plan} onChange={set("plan")}>
          {plans.map((p) => <option key={p.name} value={p.name}>{p.name} — {p.monthly_message_quota.toLocaleString()} msgs, {p.max_bots} bot(s)</option>)}
        </select>
      </label>
      <label style={label}>Owner login (email) *<input style={input} value={form.owner_email} onChange={set("owner_email")} required placeholder="owner@acme.com" autoComplete="off" /></label>
      <label style={label}>Owner password * (min 10 characters)<input style={input} type="password" value={form.owner_password} onChange={set("owner_password")} required minLength={10} autoComplete="new-password" /></label>
      <button type="submit" style={{ ...smallBtn("#2563eb", "#fff"), padding: "9px 20px", fontSize: 13, justifySelf: "start" }}>Create Tenant</button>
    </form>
  );
}

function ManageTenant({ tenant, plans, onSave, onResetPassword, onAddUser, onDelete }: {
  tenant: Tenant;
  plans: Plan[];
  onSave: (body: object) => void;
  onResetPassword: (userId: string, password: string) => void;
  onAddUser: (email: string, password: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [plan, setPlan] = useState(tenant.plan);
  const [quota, setQuota] = useState(tenant.monthly_message_quota);
  const [maxBots, setMaxBots] = useState(tenant.max_bots);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Picking a different plan pre-fills that plan's limits; they can still be overridden before saving
  function choosePlan(next: string) {
    setPlan(next);
    const p = plans.find((x) => x.name === next);
    if (p) { setQuota(p.monthly_message_quota); setMaxBots(p.max_bots); }
  }

  function resetPassword(userId: string, email: string) {
    const pw = prompt(`New password for ${email} (min 10 characters). Their current sessions will be signed out.`);
    if (pw) onResetPassword(userId, pw);
  }

  return (
    <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 16, paddingTop: 16 }}>
      <form
        onSubmit={(e) => { e.preventDefault(); onSave({ name, plan, monthly_message_quota: quota, max_bots: maxBots }); }}
        style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}
      >
        <label style={label}>Name<input style={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></label>
        <label style={label}>Plan
          <select style={input} value={plan} onChange={(e) => choosePlan(e.target.value)}>
            {plans.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            {!plans.some((p) => p.name === plan) && <option value={plan}>{plan}</option>}
          </select>
        </label>
        <label style={label}>Messages / month<input style={input} type="number" min={0} value={quota} onChange={(e) => setQuota(Math.max(0, parseInt(e.target.value) || 0))} /></label>
        <label style={label}>Max bots<input style={input} type="number" min={0} value={maxBots} onChange={(e) => setMaxBots(Math.max(0, parseInt(e.target.value) || 0))} /></label>
        <button type="submit" style={{ ...smallBtn("#2563eb", "#fff"), padding: "9px 16px" }}>Save</button>
      </form>

      <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", margin: "18px 0 8px" }}>Logins</div>
      {tenant.users.map((u) => (
        <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, marginBottom: 6 }}>
          <span style={{ flex: 1, color: "#475569" }}>{u.email}</span>
          <button type="button" style={smallBtn("#f1f5f9", "#1e293b")} onClick={() => resetPassword(u.id, u.email)}>Reset password</button>
        </div>
      ))}
      <form
        onSubmit={(e) => { e.preventDefault(); onAddUser(newEmail, newPassword); setNewEmail(""); setNewPassword(""); }}
        style={{ display: "flex", gap: 8, marginTop: 8 }}
      >
        <input style={{ ...input, flex: 1 }} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Add another login (email)" required autoComplete="off" />
        <input style={{ ...input, flex: 1 }} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Password (min 10)" required minLength={10} autoComplete="new-password" />
        <button type="submit" style={smallBtn("#f1f5f9", "#1e293b")}>Add login</button>
      </form>

      <button type="button" onClick={onDelete} style={{ marginTop: 18, background: "none", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>
        Delete tenant and all its data
      </button>
    </div>
  );
}
