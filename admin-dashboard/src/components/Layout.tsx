import { useEffect } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";

const navStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: 220,
  minHeight: "100vh",
  background: "#1e293b",
  padding: "24px 0",
  gap: 4,
  flexShrink: 0,
};

const linkBase: React.CSSProperties = {
  padding: "10px 24px",
  color: "#94a3b8",
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 0,
  transition: "background 0.1s, color 0.1s",
};

const linkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  ...linkBase,
  color: isActive ? "#f1f5f9" : "#94a3b8",
  background: isActive ? "#334155" : "transparent",
});

export default function Layout() {
  const logout = useAuthStore((s) => s.logout);
  const me = useAuthStore((s) => s.me);
  const setMe = useAuthStore((s) => s.setMe);
  const navigate = useNavigate();
  const location = useLocation();

  // Refreshed on every navigation so the usage meter stays current
  useEffect(() => {
    api.get("/auth/me").then((r) => setMe(r.data)).catch(() => undefined);
  }, [location.pathname, setMe]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const tenant = me?.tenant ?? null;
  const quotaUsed = tenant ? Math.min(100, Math.round((tenant.platform_messages_this_month / Math.max(1, tenant.monthly_message_quota)) * 100)) : 0;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav style={navStyle}>
        <div style={{ padding: "0 24px 20px", color: "#f1f5f9", fontWeight: 700, fontSize: 16, borderBottom: "1px solid #334155", marginBottom: 8 }}>
          ChatBot Admin
          {me && (
            <div style={{ fontSize: 11, fontWeight: 500, color: "#94a3b8", marginTop: 4 }}>
              {me.role === "superadmin" ? "Platform operator" : tenant?.name}
            </div>
          )}
        </div>
        {me?.role === "superadmin" && (
          <NavLink to="/tenants" style={linkStyle}>Tenants</NavLink>
        )}
        <NavLink to="/clients" style={linkStyle}>Bots</NavLink>
        <NavLink to="/settings" style={linkStyle}>Settings</NavLink>

        <div style={{ marginTop: "auto", padding: "24px 24px 0" }}>
          {tenant && (
            <div style={{ marginBottom: 16, fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
              <div style={{ textTransform: "uppercase", letterSpacing: 0.5, color: "#cbd5e1", fontWeight: 700 }}>{tenant.plan} plan</div>
              <div>{tenant.bots_used} / {tenant.max_bots} bots</div>
              <div title="Messages answered with the platform's AI key. Bots using your own key are not limited.">
                {tenant.platform_messages_this_month.toLocaleString()} / {tenant.monthly_message_quota.toLocaleString()} messages
              </div>
              <div style={{ height: 4, background: "#334155", borderRadius: 2, marginTop: 6 }}>
                <div style={{ height: 4, width: `${quotaUsed}%`, background: quotaUsed >= 90 ? "#f87171" : "#38bdf8", borderRadius: 2 }} />
              </div>
            </div>
          )}
          <button onClick={handleLogout} style={{ background: "none", border: "1px solid #475569", color: "#94a3b8", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, width: "100%" }}>
            Log out
          </button>
        </div>
      </nav>
      <main style={{ flex: 1, padding: 32, maxWidth: 960 }}>
        <Outlet />
      </main>
    </div>
  );
}
