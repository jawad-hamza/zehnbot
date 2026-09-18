import { Outlet, NavLink, useNavigate } from "react-router-dom";
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

export default function Layout() {
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav style={navStyle}>
        <div style={{ padding: "0 24px 20px", color: "#f1f5f9", fontWeight: 700, fontSize: 16, borderBottom: "1px solid #334155", marginBottom: 8 }}>
          ChatBot Admin
        </div>
        <NavLink to="/clients" style={({ isActive }) => ({ ...linkBase, color: isActive ? "#f1f5f9" : "#94a3b8", background: isActive ? "#334155" : "transparent" })}>
          Clients
        </NavLink>
        <NavLink to="/settings" style={({ isActive }) => ({ ...linkBase, color: isActive ? "#f1f5f9" : "#94a3b8", background: isActive ? "#334155" : "transparent" })}>
          Settings
        </NavLink>
        <div style={{ marginTop: "auto", padding: "24px 24px 0" }}>
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
