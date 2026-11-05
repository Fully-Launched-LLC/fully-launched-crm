"use client";

import { useState } from "react";
import type { SavedSearch } from "@/lib/sales/savedSearch";
import { relativeTime } from "@/lib/leads/labels";

// "Save search": a small inline name box (launch pad console, Mission
// Control header). Prefilled with defaultSearchName().
export function SaveSearchButton({
  defaultName,
  onSave,
  className = "btn",
}: {
  defaultName: () => string;
  onSave: (name: string) => Promise<string | null>;
  className?: string;
}) {
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (name == null || !name.trim()) return;
    setBusy(true);
    const err = await onSave(name.trim());
    setBusy(false);
    if (err) return setMsg({ tone: "error", text: err });
    setName(null);
    setMsg({ tone: "ok", text: "Saved to My saved searches." });
    setTimeout(() => setMsg(null), 2500);
  }

  if (name == null)
    return (
      <span className="save-search">
        <button type="button" className={className} onClick={() => { setMsg(null); setName(defaultName()); }}>
          Save search
        </button>
        {msg && <span className={msg.tone === "ok" ? "hint" : "bad-text"}>{msg.text}</span>}
      </span>
    );
  return (
    <span className="save-search">
      <input
        className="field"
        autoFocus
        aria-label="Saved search name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setName(null);
        }}
      />
      <button type="button" className="btn btn-gold" disabled={busy} onClick={() => void save()}>Save</button>
      <button type="button" className="btn" onClick={() => setName(null)}>Cancel</button>
      {msg && msg.tone === "error" && <span className="bad-text">{msg.text}</span>}
    </span>
  );
}

// "My saved searches" (launch pad, above Matteo's saved missions): name,
// last run, Run, Rename, Delete. Sweeps only for Admin/Manager.
export function SavedSearchesPanel({
  items,
  canSweep,
  onRun,
  onRename,
  onDelete,
}: {
  items: SavedSearch[];
  canSweep: boolean;
  onRun: (s: SavedSearch) => void;
  onRename: (s: SavedSearch, name: string) => Promise<string | null>;
  onDelete: (s: SavedSearch) => Promise<string | null>;
}) {
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = items.filter((s) => s.kind === "search" || canSweep);
  if (!shown.length) return null;

  return (
    <div className="panel recent saved-searches">
      <h2>My saved searches</h2>
      {error && <p className="bad-text" style={{ padding: "0 16px 8px", fontSize: 12.5 }}>{error}</p>}
      {shown.map((s) => (
        <div key={s.id} className="r ss-row">
          {renaming?.id === s.id ? (
            <span className="save-search" style={{ flex: 1 }}>
              <input
                className="field"
                autoFocus
                aria-label="New name"
                value={renaming.name}
                onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
                onKeyDown={async (e) => {
                  if (e.key === "Escape") setRenaming(null);
                  if (e.key === "Enter" && renaming.name.trim()) {
                    const err = await onRename(s, renaming.name.trim());
                    setError(err);
                    if (!err) setRenaming(null);
                  }
                }}
              />
            </span>
          ) : (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="r-name">{s.name}</div>
              <div className="r-meta">
                {s.kind === "sweep" ? "Area sweep" : "Quick search"} · {s.last_run_at ? `last run ${relativeTime(s.last_run_at)}` : "never run"}
              </div>
            </div>
          )}
          <div className="ss-btns">
            <button type="button" className="btn btn-gold" onClick={() => onRun(s)}>
              Run
            </button>
            <button type="button" className="btn" onClick={() => setRenaming({ id: s.id, name: s.name })}>
              Rename
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                setError(await onDelete(s));
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
