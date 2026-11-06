"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// A phone number alone never merges two companies (migration 035). When
// another company record has this project's phone, suggest linking it here:
// "Same phone as Comfort X Design. Link this project to that company?"
// link_project_to_company() moves the project (any team member) and removes
// the old record if it was an empty auto-created one. "Not the same
// company" is saved per pair (project_link_dismissals), so it stays hidden.
export default function CompanySuggestion({ projectId, phone }: { projectId: string; phone: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [options, setOptions] = useState<{ lead_id: string; company: string }[]>([]);
  const [hidden, setHidden] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if ((phone ?? "").replace(/\D/g, "").length < 10) return setOptions([]);
    let live = true;
    void supabase
      .rpc("company_phone_suggestions", { p_project_id: projectId })
      .then(({ data }) => live && setOptions((data ?? []) as { lead_id: string; company: string }[]));
    return () => {
      live = false;
    };
  }, [projectId, phone, supabase]);

  const shown = options.filter((o) => !dismissed.includes(o.lead_id));
  if (hidden || !shown.length) return null;

  async function dismiss(leadId: string) {
    setError(null);
    const { error } = await supabase.from("project_link_dismissals").insert({ project_id: projectId, lead_id: leadId });
    // Already dismissed by someone else (unique pair): hide it all the same.
    if (error && error.code !== "23505") return setError(error.message);
    setDismissed((d) => [...d, leadId]);
  }

  async function link(leadId: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("link_project_to_company", { p_project_id: projectId, p_lead_id: leadId });
    setBusy(false);
    if (error) return setError(error.message);
    setHidden(true);
    router.refresh();
  }

  return (
    <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {shown.map((o) => (
        <div key={o.lead_id} className="flex flex-wrap items-center gap-2">
          <span>
            Same phone as <b>{o.company}</b>. Same company?
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void link(o.lead_id)}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-50"
          >
            Link this project to {o.company}
          </button>
          <button type="button" disabled={busy} onClick={() => void dismiss(o.lead_id)} className="text-xs underline">
            Not the same company
          </button>
        </div>
      ))}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}
