import { useState } from "react";
import { api, errorDetail } from "../api/client";
import type { LauncherSlot } from "../types";

const SLOTS: { slot: LauncherSlot; title: string; help: string }[] = [
  { slot: "normal", title: "Normal", help: "What visitors see at rest. Needed for the other two." },
  { slot: "hover", title: "Hover", help: "While the pointer is over it (or it has keyboard focus)." },
  { slot: "open", title: "Clicked", help: "After a click, while the chat is open." },
];
const ACCEPT = "image/gif,image/png,image/svg+xml,.gif,.png,.svg";

interface Props {
  clientUuid?: string;
  initial: Partial<Record<LauncherSlot, string>>;
}

/**
 * The launcher button's own pictures: a GIF, PNG or SVG for each state. Uploaded (and removed) straight
 * away, separately from the form's Save button, because they are files rather than settings.
 */
export default function LauncherPictures({ clientUuid, initial }: Props) {
  const [images, setImages] = useState(initial);
  const [busy, setBusy] = useState<LauncherSlot | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (!clientUuid) {
    return (
      <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--subtle-fg)" }}>
        Launcher pictures (animated GIF, PNG or SVG for the normal, hover and clicked states) can be added once the bot is created.
      </div>
    );
  }

  async function upload(slot: LauncherSlot, file: File | undefined) {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setNote({ ok: false, text: "That picture is larger than 1 MB. A launcher is 56 to 64 pixels, so export it smaller." });
      return;
    }
    setBusy(slot);
    setNote(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await api.put(`/admin/clients/${clientUuid}/launcher/${slot}`, body);
      setImages(res.data.launcher_images ?? {});
      setNote({ ok: true, text: "Saved. Websites show it on their next page load." });
    } catch (err: unknown) {
      setNote({ ok: false, text: errorDetail(err, "Could not upload the picture.") });
    } finally {
      setBusy(null);
    }
  }

  async function remove(slot: LauncherSlot) {
    setBusy(slot);
    setNote(null);
    try {
      const res = await api.delete(`/admin/clients/${clientUuid}/launcher/${slot}`);
      setImages(res.data.launcher_images ?? {});
    } catch (err: unknown) {
      setNote({ ok: false, text: errorDetail(err, "Could not remove the picture.") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>Launcher pictures (optional)</div>
      <p style={{ fontSize: 12, color: "var(--subtle-fg)", margin: "4px 0 10px" }}>
        Replace the round chat button with your own animated GIF, PNG or SVG, up to 1 MB each. Shown at 64 × 64 pixels.
        Without a normal picture the standard button is used.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {SLOTS.map(({ slot, title, help }) => {
          const src = images[slot];
          const inputId = `launcher-${slot}`;
          const locked = slot !== "normal" && !images.normal;
          return (
            <div key={slot} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 8, background: "var(--surface-2)", display: "grid", placeItems: "center", overflow: "hidden" }}>
                  {src ? <img src={src} alt={`${title} launcher picture`} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 11, color: "var(--subtle-fg)" }}>None</span>}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--subtle-fg)", lineHeight: 1.35 }}>{help}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <label htmlFor={inputId} className="zb-btn zb-btn--secondary zb-btn--sm" aria-disabled={locked || busy !== null}
                  style={{ cursor: locked || busy ? "not-allowed" : "pointer", opacity: locked ? 0.55 : 1 }}>
                  {busy === slot ? "Uploading…" : src ? "Replace" : "Upload"}
                </label>
                <input id={inputId} type="file" accept={ACCEPT} className="zb-sr-only" disabled={locked || busy !== null}
                  onChange={(e) => { upload(slot, e.target.files?.[0]); e.target.value = ""; }} />
                {src && <button type="button" className="zb-btn zb-btn--ghost zb-btn--sm" disabled={busy !== null} onClick={() => remove(slot)}>Remove</button>}
              </div>
            </div>
          );
        })}
      </div>
      {note && <p role={note.ok ? "status" : "alert"} style={{ fontSize: 12.5, marginTop: 8, color: note.ok ? "var(--success)" : "var(--danger)" }}>{note.text}</p>}
    </div>
  );
}
