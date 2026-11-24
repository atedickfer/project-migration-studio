import { useEffect, useState, type FormEvent } from "react";

import { LIMITS, cleanThreadInput, type MediaFilter } from "@/lib/threadarch/core";
import type { JobPayload } from "@/hooks/use-archive-job";

const STORAGE_KEY = "threadarch_session_cookie_v1";

export function ArchiveForm({
  busy,
  outDir,
  onOutDirChange,
  onSubmit,
}: {
  busy: boolean;
  outDir: string;
  onOutDirChange: (v: string) => void;
  onSubmit: (p: JobPayload) => void;
}) {
  const [cookie, setCookie] = useState("");
  const [saveLocal, setSaveLocal] = useState(true);
  const [url, setUrl] = useState("");
  const [workers, setWorkers] = useState(LIMITS.workers.def);
  const [resolveWorkers, setResolveWorkers] = useState(LIMITS.resolveWorkers.def);
  const [dlWorkers, setDlWorkers] = useState(LIMITS.dlWorkers.def);
  const [media, setMedia] = useState<MediaFilter>("all");
  const [resume, setResume] = useState(true);
  const [linksOnly, setLinksOnly] = useState(false);
  const [singlePage, setSinglePage] = useState(false);
  const [includeQuotes, setIncludeQuotes] = useState(false);
  const [userAgent, setUserAgent] = useState("");
  const [alert, setAlert] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setCookie(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (saveLocal && cookie.trim()) localStorage.setItem(STORAGE_KEY, cookie);
      else if (!saveLocal) localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [cookie, saveLocal]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setAlert("");
    if (!cookie.trim()) return setAlert("Paste your session cookie first — jobs require a cookie input.");
    const clean = cleanThreadInput(url);
    if (!/^https?:\/\//i.test(clean)) return setAlert("Enter a thread URL first.");
    onSubmit({
      url: clean,
      cookie: cookie.trim(),
      workers,
      resolveWorkers,
      dlWorkers,
      media,
      outDir,
      resume,
      linksOnly,
      singlePage,
      includeQuotes,
      userAgent: userAgent.trim(),
    });
  }

  const num = (v: string) => Number(v || 0);

  return (
    <form className="deck-card" onSubmit={submit}>
      <div className="label-row">
        <label className="field-label" htmlFor="cookie">Session Cookie (Netscape or Header)</label>
        <span className="req-tag">* REQUIRED</span>
      </div>
      <textarea id="cookie" className="deck-input" rows={4} value={cookie} onChange={(e) => setCookie(e.target.value)}
        placeholder="Paste Netscape cookie export or name=val; name2=val2 here..." />
      <div className="label-row mt-1.5">
        <span className="hint-note">Sent per job — never stored on the server.</span>
        <button type="button" className="mini-btn" onClick={() => { setCookie(""); try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } }}>
          WIPE SAVED
        </button>
      </div>

      <div className="mt-3">
        <label className="field-label" htmlFor="url">Thread / Page URL</label>
        <input id="url" className="deck-input" type="text" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example-forum.com/threads/..." />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div><label className="field-label" htmlFor="workers">Scrape W</label>
          <input id="workers" className="deck-input" type="number" min={1} max={8} value={workers} onChange={(e) => setWorkers(num(e.target.value))} /></div>
        <div><label className="field-label" htmlFor="rw">Resolve W</label>
          <input id="rw" className="deck-input" type="number" min={1} max={12} value={resolveWorkers} onChange={(e) => setResolveWorkers(num(e.target.value))} /></div>
        <div><label className="field-label" htmlFor="dw">DL W</label>
          <input id="dw" className="deck-input" type="number" min={1} max={12} value={dlWorkers} onChange={(e) => setDlWorkers(num(e.target.value))} /></div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div><label className="field-label" htmlFor="media">Media Filter</label>
          <select id="media" className="deck-input" value={media} onChange={(e) => setMedia(e.target.value as MediaFilter)}>
            <option value="all">ALL MEDIA</option>
            <option value="video">VIDEO ONLY</option>
            <option value="image">IMAGE ONLY</option>
          </select></div>
        <div><label className="field-label" htmlFor="out">Output Folder</label>
          <input id="out" className="deck-input" type="text" value={outDir} onChange={(e) => onOutDirChange(e.target.value)} /></div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <label className="chip"><input type="checkbox" checked={saveLocal} onChange={(e) => setSaveLocal(e.target.checked)} /> SAVE ON PHONE</label>
        <label className="chip"><input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} /> RESUME</label>
        <label className="chip"><input type="checkbox" checked={linksOnly} onChange={(e) => setLinksOnly(e.target.checked)} /> LINKS ONLY</label>
        <label className="chip"><input type="checkbox" checked={singlePage} onChange={(e) => setSinglePage(e.target.checked)} /> SINGLE PAGE</label>
        <label className="chip"><input type="checkbox" checked={includeQuotes} onChange={(e) => setIncludeQuotes(e.target.checked)} /> INCLUDE QUOTES</label>
      </div>

      <details className="deck-details">
        <summary>+ CUSTOM USER-AGENT (OPTIONAL)</summary>
        <div className="mt-2.5">
          <label className="field-label" htmlFor="ua">Custom User-Agent</label>
          <input id="ua" className="deck-input" type="text" value={userAgent} onChange={(e) => setUserAgent(e.target.value)}
            placeholder="Leave blank to use default mobile UA" />
        </div>
      </details>

      {alert && <div className="alert-box">{alert}</div>}
      <button className="drop-btn" type="submit" disabled={busy}>START ARCHIVE</button>
    </form>
  );
}
