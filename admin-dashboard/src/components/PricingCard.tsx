import { useEffect, useState } from "react";
import { api, errorDetail } from "../api/client";

type PlanId = "free" | "starter" | "pro" | "business";
interface Pricing {
  currency: string;
  recommended: PlanId | null;
  plans: Record<PlanId, { price: number; blurb: string }>;
}
const ORDER: PlanId[] = ["free", "starter", "pro", "business"];

/**
 * Super admin only. The prices and one-line descriptions shown on the public landing page
 * (which reads them from /api/public/plans). What each plan INCLUDES is fixed in the code.
 */
export default function PricingCard() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get("/admin/pricing").then((r) => setPricing(r.data)).catch((err: unknown) => setNote({ ok: false, text: errorDetail(err, "Could not load the prices.") }));
  }, []);

  if (!pricing) return note ? <div className="zb-alert zb-alert--danger" role="alert">{note.text}</div> : null;

  const setPlan = (id: PlanId, change: Partial<{ price: number; blurb: string }>) =>
    setPricing((p) => (p ? { ...p, plans: { ...p.plans, [id]: { ...p.plans[id], ...change } } } : p));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const res = await api.put("/admin/pricing", pricing);
      setPricing(res.data);
      setNote({ ok: true, text: "Saved. The landing page shows the new prices within five minutes." });
    } catch (err: unknown) {
      setNote({ ok: false, text: errorDetail(err, "Could not save the prices.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="zb-card zb-card--pad" aria-labelledby="settings-pricing">
      <h2 className="zb-card-title" id="settings-pricing">Plans and pricing</h2>
      <p className="zb-card-sub">What the public landing page shows. Prices are per month. What each plan includes (bots, messages) is set in the code, and billing is still arranged by hand: changing a price here charges nobody.</p>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 18 }}>
        <div className="zb-field" style={{ maxWidth: 160 }}>
          <label className="zb-label" htmlFor="price-currency">Currency</label>
          <input id="price-currency" className="zb-input" value={pricing.currency} onChange={(e) => setPricing({ ...pricing, currency: e.target.value })} maxLength={4} required aria-describedby="price-currency-help" />
          <span className="zb-help" id="price-currency-help">A symbol or code: $, £, Rs, USD.</span>
        </div>

        <div className="zb-table-wrap">
          <table className="zb-table">
            <thead><tr><th scope="col">Plan</th><th scope="col">Price a month</th><th scope="col">One line under the price</th><th scope="col">Recommended</th></tr></thead>
            <tbody>
              {ORDER.map((id) => (
                <tr key={id}>
                  <th scope="row" style={{ textTransform: "capitalize", fontWeight: 600 }}>{id}</th>
                  <td>
                    <label className="zb-sr-only" htmlFor={`price-${id}`}>{id} price a month</label>
                    <input id={`price-${id}`} className="zb-input zb-num" style={{ width: 120 }} type="number" min={0} max={100000} step="0.01" inputMode="decimal"
                      value={pricing.plans[id].price} disabled={id === "free"} onChange={(e) => setPlan(id, { price: Number(e.target.value) })} />
                  </td>
                  <td>
                    <label className="zb-sr-only" htmlFor={`blurb-${id}`}>{id} description</label>
                    <input id={`blurb-${id}`} className="zb-input" style={{ minWidth: 220 }} value={pricing.plans[id].blurb} maxLength={120} onChange={(e) => setPlan(id, { blurb: e.target.value })} />
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer" }}>
                      <input type="radio" name="recommended" checked={pricing.recommended === id} onChange={() => setPricing({ ...pricing, recommended: id })} />
                      <span className="zb-sr-only">Recommend {id}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="zb-help">The free plan always costs nothing.{pricing.recommended && <> <button type="button" className="zb-link" onClick={() => setPricing({ ...pricing, recommended: null })}>Recommend none</button></>}</p>

        {note && <div role={note.ok ? "status" : "alert"} className={`zb-alert ${note.ok ? "zb-alert--info" : "zb-alert--danger"}`}>{note.text}</div>}
        <button type="submit" className="zb-btn zb-btn--primary" disabled={saving} style={{ alignSelf: "flex-start" }}>{saving ? "Saving…" : "Save prices"}</button>
      </form>
    </section>
  );
}
