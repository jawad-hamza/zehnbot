import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { loginPathFor, useAuthStore } from "../store/authStore";
import ThemeToggle from "./ThemeToggle";
import { BrandMark, IconBot, IconHome, IconLogout, IconMenu, IconInbox, IconSettings, IconUsers } from "./icons";

/** The signed-in shell. One component, two workspaces: what the sidebar offers depends on the
 *  role, so the operator's console and a customer's dashboard never show each other's tools. */
export default function Layout() {
  const logout = useAuthStore((s) => s.logout);
  const me = useAuthStore((s) => s.me);
  const setMe = useAuthStore((s) => s.setMe);
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Refreshed on every navigation so the usage meter stays current
  useEffect(() => {
    api.get("/auth/me").then((r) => setMe(r.data)).catch(() => undefined);
    setMenuOpen(false);
  }, [location.pathname, setMe]);

  function handleLogout() {
    const back = loginPathFor(useAuthStore.getState().kind);
    logout();
    navigate(back);
  }

  const isOperator = me?.role === "superadmin";
  const workspace = me?.tenant ?? null;
  const used = workspace ? workspace.platform_messages_this_month / Math.max(1, workspace.monthly_message_quota) : 0;
  const meterClass = used >= 1 ? "zb-meter zb-meter--danger" : used >= 0.8 ? "zb-meter zb-meter--warn" : "zb-meter";
  const initials = (me?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="zb-shell">
      <button type="button" className={`zb-scrim${menuOpen ? " open" : ""}`} aria-label="Close menu" onClick={() => setMenuOpen(false)} />

      <nav className={`zb-sidebar${menuOpen ? " open" : ""}`} aria-label="Main">
        <Link to="/overview" className="zb-brand"><BrandMark /> ZehnBot</Link>

        <div className="zb-nav-section">{isOperator ? "Platform" : "Workspace"}</div>
        <NavLink to="/overview" className="zb-nav-link"><IconHome /> Overview</NavLink>
        {isOperator && <NavLink to="/tenants" className="zb-nav-link"><IconUsers /> Tenants</NavLink>}
        {isOperator && <NavLink to="/enquiries" className="zb-nav-link"><IconInbox /> Enquiries</NavLink>}
        <NavLink to="/bots" className="zb-nav-link"><IconBot /> {isOperator ? "All bots" : "Bots"}</NavLink>

        <div className="zb-nav-section">Account</div>
        <NavLink to="/settings" className="zb-nav-link"><IconSettings /> Settings</NavLink>

        <div className="zb-sidebar-foot">
          {workspace && (
            <div className="zb-usage">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span className="zb-badge zb-badge--primary" style={{ textTransform: "capitalize" }}>{workspace.plan} plan</span>
                <span>{workspace.bots_used} / {workspace.max_bots} bots</span>
              </div>
              <div style={{ marginTop: 10 }} title="Messages answered with the platform's AI. Bots that use your own AI key are not limited.">
                {workspace.platform_messages_this_month.toLocaleString()} of {workspace.monthly_message_quota.toLocaleString()} messages this month
              </div>
              <div className={meterClass} role="progressbar" aria-label="Monthly message quota used"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(used * 100))}>
                <span style={{ width: `${Math.min(100, Math.round(used * 100))}%` }} />
              </div>
            </div>
          )}
          <button type="button" className="zb-nav-link" onClick={handleLogout} style={{ width: "100%", border: "none", background: "none", textAlign: "left" }}>
            <IconLogout /> Log out
          </button>
        </div>
      </nav>

      <div className="zb-main">
        <header className="zb-topbar">
          <button type="button" className="zb-icon-btn zb-menu-btn" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            <IconMenu />
          </button>
          <span className="zb-topbar-title">{isOperator ? "Operator console" : workspace?.name ?? ""}</span>
          <span className="zb-topbar-spacer" />
          <ThemeToggle />
          <div className="zb-user">
            <span>{me?.email}</span>
            <div className="zb-avatar" aria-hidden="true">{initials}</div>
          </div>
        </header>
        <main className="zb-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
