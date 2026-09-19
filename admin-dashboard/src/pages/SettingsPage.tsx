import { useEffect, useState } from "react";
import { api, errorDetail } from "../api/client";
import { PasswordField } from "../components/AuthShell";
import ContactDialog, { type ContactRequest } from "../components/ContactDialog";
import PricingCard from "../components/PricingCard";
import ThemeToggle from "../components/ThemeToggle";
import { useAuthStore } from "../store/authStore";

type Note = { type: "ok" | "err"; text: string } | null;

function Feedback({ note }: { note: Note }) {
  if (!note) return null;
  return <div role={note.type === "err" ? "alert" : "status"} className={`zb-alert ${note.type === "err" ? "zb-alert--danger" : "zb-alert--info"}`}>{note.text}</div>;
}

/** The workspace card: a customer may rename it; the plan and its limits belong to the platform operator. */
function WorkspaceCard() {
  const me = useAuthStore((s) => s.me);
  const setMe = useAuthStore((s) => s.setMe);
  const workspace = me?.tenant ?? null;
  const [name, setName] = useState(workspace?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [contact, setContact] = useState<ContactRequest | null>(null);

  useEffect(() => setName(workspace?.name ?? ""), [workspace?.name]);
  if (!me || !workspace) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const res = await api.put("/admin/workspace", { name });
      setMe({ ...me!, tenant: { ...workspace!, name: res.data.name } });
      setNote({ type: "ok", text: "Workspace renamed." });
    } catch (err: unknown) {
      setNote({ type: "err", text: errorDetail(err, "Could not rename the workspace.") });
    } finally {
      setSaving(false);
    }
  }

  const unchanged = name.trim() === workspace.name;
  return (
    <section className="zb-card zb-card--pad" aria-labelledby="settings-workspace">
      <h2 className="zb-card-title" id="settings-workspace">Workspace</h2>
      <p className="zb-card-sub">The name your team sees in the dashboard. Visitors never see it.</p>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 18 }}>
        <div className="zb-field">
          <label className="zb-label" htmlFor="workspace-name">Workspace name</label>
          <input id="workspace-name" className="zb-input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={255} required />
        </div>
        <dl style={{ margin: 0 }}>
          <div className="zb-status-row"><dt>Plan</dt><dd style={{ textTransform: "capitalize" }}>{workspace.plan}</dd></div>
          <div className="zb-status-row"><dt>Bots</dt><dd className="zb-num">{workspace.bots_used} of {workspace.max_bots}</dd></div>
          <div className="zb-status-row"><dt>Messages this month</dt><dd className="zb-num">{workspace.platform_messages_this_month.toLocaleString()} of {workspace.monthly_message_quota.toLocaleString()}</dd></div>
        </dl>
        <p className="zb-help">
          There is no online checkout yet. To change your plan,{" "}
          <button type="button" className="zb-link" onClick={() => setContact({ source: "settings-plan", defaults: { email: me.email.includes("@") ? me.email : undefined, company: workspace.name } })}>ask the Zehnox team</button>.
        </p>
        <Feedback note={note} />
        <button type="submit" className="zb-btn zb-btn--primary" disabled={saving || unchanged} style={{ alignSelf: "flex-start" }}>{saving ? "Saving…" : "Save name"}</button>
      </form>
      <ContactDialog request={contact} onClose={() => setContact(null)} />
    </section>
  );
}

function LoginCard() {
  const [currentEmail, setCurrentEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const setToken = useAuthStore((s) => s.setToken);
  const [hasPassword, setHasPassword] = useState(true);     // false for a login that has only ever used Google
  const [googleLinked, setGoogleLinked] = useState(false);

  useEffect(() => {
    api.get("/auth/me").then((r) => {
      setCurrentEmail(r.data.email);
      setNewEmail(r.data.email);
      setHasPassword(r.data.has_password !== false);
      setGoogleLinked(!!r.data.google_linked);
    }).catch(() => undefined);
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const res = await api.post("/auth/change-credentials", {
        current_password: hasPassword ? currentPassword : undefined,
        new_email: newEmail !== currentEmail ? newEmail : undefined,
        new_password: newPassword || undefined,
      });
      // a password change revokes the old session token; the server hands back a new one
      setToken(res.data.access_token);
      setCurrentEmail(newEmail);
      setCurrentPassword("");
      if (newPassword) setHasPassword(true);
      setNewPassword("");
      setNote({ type: "ok", text: "Login details updated." });
    } catch (err: unknown) {
      setNote({ type: "err", text: errorDetail(err, "Could not update your login details.") });
    } finally {
      setSaving(false);
    }
  }

  const nothingToSave = newEmail === currentEmail && !newPassword;
  return (
    <section className="zb-card zb-card--pad" aria-labelledby="settings-login">
      <h2 className="zb-card-title" id="settings-login">Login details</h2>
      <p className="zb-card-sub">
        {hasPassword ? "Changing your password signs out every other device." : "You sign in with Google. Set a password here if you also want to log in with your email."}
        {googleLinked && hasPassword ? " Google sign-in is connected to this login." : ""}
      </p>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 18 }}>
        <div className="zb-field">
          <label className="zb-label" htmlFor="settings-email">Email</label>
          <input id="settings-email" className="zb-input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="username" required />
        </div>
        <div className="zb-field">
          <label className="zb-label" htmlFor="settings-new-password">New password</label>
          <input id="settings-new-password" className="zb-input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            minLength={10} autoComplete="new-password" aria-describedby="settings-new-password-help" />
          <span className="zb-help" id="settings-new-password-help">At least 10 characters. Leave it empty to keep the one you have.</span>
        </div>
        {hasPassword && <PasswordField id="settings-current-password" label="Current password, to confirm it is you" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />}
        <Feedback note={note} />
        <button type="submit" className="zb-btn zb-btn--primary" disabled={saving || nothingToSave} style={{ alignSelf: "flex-start" }}>{saving ? "Saving…" : "Save changes"}</button>
      </form>
    </section>
  );
}

export default function SettingsPage() {
  const isOperator = useAuthStore((s) => s.me?.role === "superadmin");
  return (
    <div>
      <div className="zb-page-head">
        <div>
          <h1>Settings</h1>
          <p>{isOperator ? "Plan prices, your login, and how the dashboard looks." : "Your workspace, your login, and how the dashboard looks."}</p>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: isOperator ? 860 : 620 }}>
        {isOperator && <PricingCard />}
        <WorkspaceCard />
        <LoginCard />
        <section className="zb-card zb-card--pad" aria-labelledby="settings-look" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h2 className="zb-card-title" id="settings-look">Appearance</h2>
            <p className="zb-card-sub">Light or dark. Remembered on this device.</p>
          </div>
          <ThemeToggle />
        </section>
      </div>
    </div>
  );
}
