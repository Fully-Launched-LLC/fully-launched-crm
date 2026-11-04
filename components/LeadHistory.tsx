import type { TeamMember } from "@/lib/types";
import type { SavedAudit } from "@/lib/lead-finder/types";
import { TOUCH_CHANNEL_LABELS, TOUCH_OUTCOME_LABELS, sourceLabel } from "@/lib/leads/labels";
import LocalDateTime from "@/components/LocalDateTime";

// "Lead history" on the Manage Project page: the lead(s) this project was
// converted from (leads.project_id), their touch timeline and saved audit.

export type ProjectLeadHistory = {
  leads: {
    id: string;
    company: string | null;
    source: string;
    source_detail: string | null;
    found_by: string | null;
    created_at: string;
    audit: SavedAudit | null;
  }[];
  touches: {
    id: string;
    lead_id: string;
    channel: string;
    direction: string;
    outcome: string | null;
    summary: string | null;
    touched_by: string | null;
    touched_at: string;
  }[];
};

export default function LeadHistory({ history, teamMembers }: { history: ProjectLeadHistory; teamMembers: TeamMember[] }) {
  const name = (id: string | null) => teamMembers.find((m) => m.id === id)?.name ?? "Unknown";
  return (
    <div className="rounded-lg border border-neutral-200 p-5">
      <h2 className="text-sm font-semibold text-foreground">Lead history</h2>
      {history.leads.map((l) => {
        const audit = l.audit && l.audit.version === 1 ? l.audit : null;
        return (
          <div key={l.id} className="mt-3 space-y-2 text-sm">
            <p className="text-neutral-600">
              From lead{" "}
              <a href={`/leads?lead=${l.id}`} className="font-medium text-accent hover:underline">
                {l.company ?? "lead"}
              </a>
              {" · "}
              {sourceLabel(l.source)}
              {l.source_detail ? ` (${l.source_detail})` : ""}
              {l.found_by ? ` · found by ${name(l.found_by)}` : ""} · added <LocalDateTime iso={l.created_at} />
            </p>
            {audit && (
              <div className="rounded-md bg-neutral-50 px-3 py-2">
                <p className="text-xs text-neutral-500">
                  Audit saved <LocalDateTime iso={audit.ran_at} />
                  {audit.speed && !audit.speed.error && (
                    <>
                      {" "}
                      · speed {audit.speed.performance ?? "n/a"}, SEO {audit.speed.seo ?? "n/a"}
                    </>
                  )}
                  {" · "}
                  <a className="text-accent hover:underline" href={`/lead-finder/audit?lead=${l.id}`} target="_blank" rel="noopener noreferrer">
                    Open audit
                  </a>
                </p>
                {audit.recommendations.length > 0 && (
                  <ol className="ml-5 mt-1 list-decimal text-neutral-700">
                    {audit.recommendations.slice(0, 3).map((r) => (
                      <li key={r.title}>{r.title}</li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        );
      })}
      {history.touches.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">No touches were logged on the lead.</p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {history.touches.map((t) => (
            <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 border-l-2 border-neutral-200 pl-3 text-sm">
              <span className="font-medium text-neutral-800">{TOUCH_CHANNEL_LABELS[t.channel] ?? t.channel}</span>
              <span className="text-xs text-neutral-500">{t.direction}</span>
              {t.outcome && <span className="rounded bg-neutral-100 px-1.5 text-xs">{TOUCH_OUTCOME_LABELS[t.outcome] ?? t.outcome}</span>}
              <span className="text-xs text-neutral-500">
                {name(t.touched_by)} · <LocalDateTime iso={t.touched_at} />
              </span>
              {t.summary && <span className="w-full text-neutral-600">{t.summary}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
