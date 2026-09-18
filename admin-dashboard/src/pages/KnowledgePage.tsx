import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, errorDetail } from "../api/client";
import type { IngestJob } from "../types";

type Chunk = { id: string; chunk_text: string; chunk_index: number; source_label: string };

const POLL_MS = 2500;

export default function KnowledgePage() {
  const { id } = useParams<{ id: string }>();

  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [rawText, setRawText] = useState("");
  const [label, setLabel] = useState("manual");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [urls, setUrls] = useState("");
  const [ingestingUrl, setIngestingUrl] = useState(false);
  const [urlMsg, setUrlMsg] = useState("");

  const [crawlUrl, setCrawlUrl] = useState("");
  const [crawlMaxPages, setCrawlMaxPages] = useState(25);
  const [crawling, setCrawling] = useState(false);
  const [crawlMsg, setCrawlMsg] = useState("");

  const [uploading, setUploading] = useState(false);
  const [fileMsg, setFileMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const r = await api.get(`/admin/clients/${id}/knowledge`);
    setChunks(r.data.chunks);
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  // Stop polling if the page is left while a crawl is still running
  const pollTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pollTimer.current), []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      const res = await api.post(`/admin/clients/${id}/knowledge`, { raw_text: rawText, source_label: label.trim() || "manual" });
      setMsg(`Saved — ${res.data.chunks_created} chunks in "${label.trim() || "manual"}".`);
      setRawText("");
      await refresh();
    } catch (err: unknown) {
      setMsg(errorDetail(err, "Failed to save knowledge."));
    } finally {
      setSaving(false);
    }
  }

  // The crawl runs on the server in the background; we poll its job until it settles
  function pollJob(jobId: string) {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const job: IngestJob = (await api.get(`/admin/clients/${id}/knowledge/jobs/${jobId}`)).data;
        if (job.status === "pending" || job.status === "running") return pollJob(jobId);
        if (job.status === "done") {
          setCrawlMsg(`Crawled ${job.pages_crawled} page(s), added ${job.chunks_created} chunks.${job.error ? `\n${job.error}` : ""}`);
          setCrawlUrl("");
        } else {
          setCrawlMsg(job.error || "Crawl failed.");
        }
      } catch (err: unknown) {
        setCrawlMsg(errorDetail(err, "Lost track of the crawl. Reload the page to see what was added."));
      }
      setCrawling(false);
      await refresh();
    }, POLL_MS);
  }

  async function handleCrawl(e: React.FormEvent) {
    e.preventDefault();
    if (!crawlUrl.trim()) return;
    setCrawling(true);
    setCrawlMsg("");
    try {
      const res = await api.post(`/admin/clients/${id}/knowledge/crawl`, {
        url: crawlUrl.trim(),
        max_pages: crawlMaxPages,
      });
      pollJob(res.data.id);
    } catch (err: unknown) {
      setCrawlMsg(errorDetail(err, "Crawl failed."));
      setCrawling(false);
    }
  }

  async function handleDeleteSource(source: string) {
    if (!confirm(`Delete the source "${source}"?`)) return;
    await api.delete(`/admin/clients/${id}/knowledge`, { params: { source_label: source } });
    await refresh();
  }

  async function handleIngestUrls(e: React.FormEvent) {
    e.preventDefault();
    const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
    if (!list.length) return;
    setIngestingUrl(true);
    setUrlMsg("");
    let total = 0;
    const errors: string[] = [];
    for (const url of list) {
      try {
        const res = await api.post(`/admin/clients/${id}/knowledge/url`, { url });
        total += res.data.chunks_created;
      } catch (err: unknown) {
        errors.push(`${url}: ${errorDetail(err, "failed")}`);
      }
    }
    setUrlMsg(errors.length ? `Added ${total} chunks. ${errors.length} failed:\n${errors.join("\n")}` : `Added ${total} chunks from ${list.length} URL(s).`);
    if (total > 0) setUrls("");
    await refresh();
    setIngestingUrl(false);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    setFileMsg("");
    let total = 0;
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await api.post(`/admin/clients/${id}/knowledge/file`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        total += res.data.chunks_created;
      } catch (err: unknown) {
        errors.push(`${file.name}: ${errorDetail(err, "failed")}`);
      }
    }
    setFileMsg(errors.length ? `Added ${total} chunks. ${errors.length} failed:\n${errors.join("\n")}` : `Added ${total} chunks from ${files.length} file(s).`);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await refresh();
    setUploading(false);
  }

  async function handleDelete() {
    if (!confirm("Delete all knowledge for this client?")) return;
    await api.delete(`/admin/clients/${id}/knowledge`);
    setMsg("Knowledge deleted.");
    await refresh();
  }

  // Group chunks by source
  const sourceCounts = chunks.reduce<Record<string, number>>((acc, c) => {
    acc[c.source_label] = (acc[c.source_label] || 0) + 1;
    return acc;
  }, {});
  const sources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);

  const box: React.CSSProperties = { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18, marginBottom: 18 };
  const box_title: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 };
  const box_hint: React.CSSProperties = { fontSize: 12, color: "#64748b", marginBottom: 10 };
  const inputBase: React.CSSProperties = { padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, outline: "none", fontFamily: "inherit" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <Link to="/clients" style={{ color: "#64748b", textDecoration: "none", fontSize: 14 }}>← Bots</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Knowledge Base</h1>
        <span style={{ color: "#64748b", fontSize: 13 }}>{chunks.length} chunks · {sources.length} source(s)</span>
      </div>

      <div style={{ maxWidth: 720 }}>
        {/* Existing sources summary */}
        {sources.length > 0 && (
          <div style={{ ...box, background: "#fff" }}>
            <div style={box_title}>Current sources</div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {sources.map(([label, count]) => (
                <li key={label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <span style={{ background: "#f1f5f9", color: "#334155", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, minWidth: 40, textAlign: "center" }}>{count}</span>
                  <span style={{ color: "#475569", wordBreak: "break-all", flex: 1 }}>{label}</span>
                  <button type="button" onClick={() => handleDeleteSource(label)} title="Delete this source" style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 12 }}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={handleDelete} style={{ marginTop: 12, background: "none", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>
              Delete all
            </button>
          </div>
        )}

        {/* Crawl entire site */}
        <div style={box}>
          <div style={box_title}>Crawl entire website</div>
          <div style={box_hint}>
            Fetches the URL, follows every same-domain link (e.g. /about, /pricing, /club.html), extracts text from each page, and adds it to this bot's knowledge. Goes up to the max page count or 2 minutes, whichever comes first. Runs in the background — crawling the same site again refreshes its pages.
          </div>
          <form onSubmit={handleCrawl} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="url"
                value={crawlUrl}
                onChange={(e) => setCrawlUrl(e.target.value)}
                placeholder="https://www.futurespaceuk.com/"
                style={{ ...inputBase, flex: 1 }}
              />
              <input
                type="number"
                value={crawlMaxPages}
                onChange={(e) => setCrawlMaxPages(Math.max(1, Math.min(50, parseInt(e.target.value) || 25)))}
                min={1}
                max={50}
                title="Max pages"
                style={{ ...inputBase, width: 80 }}
              />
            </div>
            <button type="submit" disabled={crawling || !crawlUrl.trim()} style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, alignSelf: "flex-start", opacity: crawling ? 0.6 : 1 }}>
              {crawling ? "Crawling…" : "Crawl Site"}
            </button>
          </form>
          {crawlMsg && <div style={{ fontSize: 12, color: crawlMsg.startsWith("Crawled") ? "#16a34a" : "#dc2626", marginTop: 8, whiteSpace: "pre-wrap" }}>{crawlMsg}</div>}
        </div>

        {/* File upload */}
        <div style={box}>
          <div style={box_title}>Upload files</div>
          <div style={box_hint}>PDF, DOCX, TXT, MD, CSV — up to 10 MB each. Select multiple at once.</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            disabled={uploading}
            style={{ fontSize: 13 }}
          />
          {uploading && <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>Uploading…</div>}
          {fileMsg && <div style={{ fontSize: 12, color: fileMsg.includes("failed") ? "#dc2626" : "#16a34a", marginTop: 8, whiteSpace: "pre-wrap" }}>{fileMsg}</div>}
        </div>

        {/* URL ingest */}
        <div style={box}>
          <div style={box_title}>Import from URLs</div>
          <div style={box_hint}>Paste one URL per line. Each page will be fetched and its text appended to this bot's knowledge.</div>
          <form onSubmit={handleIngestUrls} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder={"https://example.com/about\nhttps://example.com/pricing"}
              style={{ ...inputBase, minHeight: 80, resize: "vertical" }}
            />
            <button type="submit" disabled={ingestingUrl || !urls.trim()} style={{ background: "#0f766e", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, alignSelf: "flex-start", opacity: ingestingUrl ? 0.6 : 1 }}>
              {ingestingUrl ? "Fetching…" : "Fetch & Add"}
            </button>
          </form>
          {urlMsg && <div style={{ fontSize: 12, color: urlMsg.startsWith("Added") && !urlMsg.includes("failed") ? "#16a34a" : "#dc2626", marginTop: 8, whiteSpace: "pre-wrap" }}>{urlMsg}</div>}
        </div>

        {/* Manual text — one source per label */}
        <form onSubmit={handleSave} style={{ ...box, background: "#fff" }}>
          <div style={box_title}>Paste text</div>
          <div style={box_hint}>
            Saved as a source with the label below. Saving again with the <strong>same label</strong> replaces that source; all other sources (uploads, URLs, crawls) are kept.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#475569" }}>Source label:</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputBase, width: 200 }} placeholder="manual" />
          </div>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            style={{ ...inputBase, minHeight: 220, resize: "vertical", width: "100%", boxSizing: "border-box" }}
            placeholder="Paste FAQs, business info, service descriptions…"
          />
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
            <button type="submit" disabled={saving || !rawText.trim()} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving || !rawText.trim() ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save Source"}
            </button>
            {msg && <span style={{ fontSize: 13, color: msg.startsWith("Saved") || msg.startsWith("Knowledge deleted") ? "#16a34a" : "#dc2626" }}>{msg}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
