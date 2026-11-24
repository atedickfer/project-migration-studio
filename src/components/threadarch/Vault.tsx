import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { downloadFolderZip, downloadVaultFile, vaultQuery } from "@/lib/threadarch/vault";

const ALL = "__ALL__";

export function Vault({ root }: { root: string }) {
  const q = useQuery(vaultQuery(root));
  const [selected, setSelected] = useState(ALL);
  const [zipping, setZipping] = useState<string | null>(null);
  const [error, setError] = useState("");

  const tree = q.data;
  const folders = tree?.folders ?? [];
  const files = tree?.files ?? [];
  const activeFolder = selected !== ALL && !folders.some((f) => f.name === selected) ? ALL : selected;
  const items = activeFolder === ALL ? files : files.filter((f) => f.folder === activeFolder);

  async function zipFolder(name: string) {
    setError("");
    setZipping(`${name} 0%`);
    try {
      await downloadFolderZip(
        files.filter((f) => f.folder === name),
        name,
        (d, t) => setZipping(`${name} ${Math.round((d / t) * 100)}%`),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setZipping(null);
    }
  }

  async function getFile(id: string) {
    setError("");
    const f = files.find((x) => x.id === id);
    if (!f) return;
    try {
      await downloadVaultFile(f);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="deck-card">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="vault-title">
          MEDIA <span>VAULT</span>
        </div>
        <button type="button" className="mini-btn mini-btn-cyan" onClick={() => void q.refetch()}>
          {q.isFetching ? "LOADING…" : "REFRESH"}
        </button>
      </div>

      <div className="mb-2.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`folder-pill ${activeFolder === ALL ? "folder-pill-active" : ""}`}
          onClick={() => setSelected(ALL)}
        >
          ALL ({files.length})
        </button>
        {folders.map((f) => (
          <span
            key={f.name}
            role="button"
            tabIndex={0}
            className={`folder-pill ${activeFolder === f.name ? "folder-pill-active" : ""}`}
            onClick={() => setSelected(f.name)}
            onKeyDown={(e) => e.key === "Enter" && setSelected(f.name)}
          >
            <span>
              {f.name} ({f.files})
            </span>
            <button
              type="button"
              className="zip-link"
              disabled={!!zipping}
              onClick={(e) => {
                e.stopPropagation();
                void zipFolder(f.name);
              }}
            >
              ZIP
            </button>
          </span>
        ))}
      </div>
      {zipping && <div className="hint-note mb-2">Zipping {zipping}…</div>}
      {error && <div className="alert-box mb-2">{error}</div>}

      <div className="file-list">
        {q.isPending ? (
          <div className="empty-vault">Loading vault files...</div>
        ) : q.isError ? (
          <div className="empty-vault">Couldn't load the vault. Try REFRESH.</div>
        ) : !items.length ? (
          <div className="empty-vault">No downloaded files in this view yet.</div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="file-row">
              <div className="min-w-0 flex-1">
                <div className="file-name">{item.name}</div>
                <div className="file-sub">
                  {item.folder} · {item.sizeFmt}
                </div>
              </div>
              <button type="button" className="dl-pill" onClick={() => void getFile(item.id)}>
                GET
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
