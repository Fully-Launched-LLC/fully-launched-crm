"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  REMOVE_REASONS,
  REVISIT_REASONS,
  revisitDateFromToday,
  type RemoveReason,
} from "@/lib/projects";

// "Remove from pipeline" on the Manage Project page. Calls the
// remove_from_pipeline() RPC: the project goes to Lost with the reason, and
// the company's business record returns to the Leads tab (Not now with a
// revisit date for Timing / not now and Just networking, else Not
// interested). Any team member may do this; the RPC checks it.
export default function RemoveFromPipelineDialog({
  projectId,
  clientName,
  onDone,
  onCancel,
}: {
  projectId: string;
  clientName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [reason, setReason] = useState<RemoveReason | null>(null);
  const [note, setNote] = useState("");
  const [revisit, setRevisit] = useState(() => revisitDateFromToday());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsRevisit = reason !== null && REVISIT_REASONS.includes(reason);
  const noteRequired = reason === "Other";
  const canSubmit =
    reason !== null &&
    (!noteRequired || note.trim().length > 0) &&
    (!needsRevisit || revisit !== "") &&
    !saving;

  async function submit() {
    if (!reason || !canSubmit) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("remove_from_pipeline", {
      p_project_id: projectId,
      p_reason: reason,
      p_note: note.trim() || null,
      p_revisit: needsRevisit ? revisit : null,
    });
    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-from-pipeline-title"
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
      >
        <p
          id="remove-from-pipeline-title"
          className="text-sm font-semibold text-neutral-800"
        >
          Remove {clientName} from the pipeline?
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          The project moves to Lost and the business goes back to the Leads
          tab.
        </p>

        <fieldset className="mt-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Reason
          </legend>
          <div className="mt-1 space-y-0.5">
            {REMOVE_REASONS.map((r) => (
              <label
                key={r}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-neutral-800 hover:bg-neutral-50"
              >
                <input
                  type="radio"
                  name="remove-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                {r}
              </label>
            ))}
          </div>
        </fieldset>

        {needsRevisit && (
          <label className="mt-3 block">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Revisit on
            </span>
            <input
              type="date"
              value={revisit}
              onChange={(e) => setRevisit(e.target.value)}
              className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </label>
        )}

        <label className="mt-3 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Note{noteRequired ? " (required)" : " (optional)"}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>

        {error && (
          <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? "Removing…" : "Remove from pipeline"}
          </button>
        </div>
      </div>
    </div>
  );
}
