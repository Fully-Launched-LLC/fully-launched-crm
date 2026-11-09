"use client";

import { useState } from "react";

export default function ExportInternalButton({ dealId }: { dealId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">
          Open the Google Doc
        </a>
      )}
      {msg && <span className="text-sm text-red-600">{msg}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const res = await fetch(`/api/deals/${dealId}/export-internal`, { method: "POST" });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) setMsg(body.error ?? "Export failed");
          else setUrl(body.url);
        }}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        {busy ? "Updating..." : "Update Google Doc"}
      </button>
    </div>
  );
}
