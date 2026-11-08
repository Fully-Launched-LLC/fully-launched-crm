"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STORAGE_URL_PREFIX, type ProjectLink, type ProjectLinkKind } from "@/lib/deals/types";

const KIND_LABELS: Record<ProjectLinkKind, string> = {
  drive_folder: "Drive folder",
  proposal_doc: "Proposal (Google Docs)",
  sow_doc: "SOW (Google Docs)",
  proposal_pdf: "Approved proposal PDFs",
  sow_pdf: "Approved SOW PDFs",
  signed_pdf: "Signed SOW",
  final_pdf: "Final SOW (countersigned)",
  internal_doc: "Internal deal doc exports",
  other: "Other links",
};
const ORDER = Object.keys(KIND_LABELS) as ProjectLinkKind[];

// Google file id from a Docs / Sheets / Slides / Drive URL.
function googleFileId(url: string): string | null {
  const m =
    url.match(/docs\.google\.com\/(?:document|spreadsheets|presentation|forms)\/d\/([A-Za-z0-9_-]{20,})/) ||
    url.match(/drive\.google\.com\/(?:file\/d|drive\/folders)\/([A-Za-z0-9_-]{20,})/) ||
    url.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

const hrefOf = (l: ProjectLink) =>
  l.url.startsWith(STORAGE_URL_PREFIX)
    ? `/api/deals/file?path=${encodeURIComponent(l.url.slice(STORAGE_URL_PREFIX.length))}`
    : l.url;

export default function ProjectDocuments({ projectId, links }: { projectId: string; links: ProjectLink[] }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    let u = url.trim();
    if (!label.trim() || !u) return setError("Enter a label and a URL.");
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    const { error: err } = await supabase.from("project_links").insert({
      project_id: projectId,
      kind: "other",
      label: label.trim(),
      url: u,
      drive_file_id: googleFileId(u),
      source: "manual",
    });
    if (err) return setError(err.message);
    setLabel("");
    setUrl("");
    router.refresh();
  }

  async function remove(id: string) {
    const { data, error: err } = await supabase.from("project_links").delete().eq("id", id).select("id");
    if (err || !data?.length) setError(err?.message ?? "Only links added by hand can be removed.");
    router.refresh();
  }

  return (
    <section className="mt-6 rounded-lg border border-neutral-200 p-5">
      <h2 className="text-sm font-semibold text-foreground">Documents</h2>
      {!links.length && <p className="mt-2 text-sm text-neutral-500">No documents yet.</p>}
      {ORDER.map((kind) => {
        const list = links.filter((l) => l.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{KIND_LABELS[kind]}</h3>
            <ul className="mt-1 divide-y divide-neutral-100">
              {list.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 py-1.5 text-sm">
                  <a href={hrefOf(l)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    {l.label}
                  </a>
                  <span className="text-xs text-neutral-500">{new Date(l.created_at).toLocaleDateString()}</span>
                  {l.kind === "other" && l.source === "manual" && (
                    <button type="button" className="ml-auto text-xs text-red-600" onClick={() => remove(l.id)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Label</span>
          <input className="rounded border border-neutral-300 px-2 py-1.5 text-sm" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="block min-w-[240px] flex-1">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">URL</span>
          <input className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button type="button" className="rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground" onClick={add}>
          Add link
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
