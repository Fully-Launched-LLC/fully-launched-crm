"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/types";
import type { LeadFinderRun } from "@/lib/lead-finder/types";
import { bodyFromRun, describeSearch } from "@/lib/sales/runBody";
import { SALES_SOURCES } from "@/lib/sales/outcomes";
import LocalDateTime from "@/components/LocalDateTime";

// History > Searches: every Find run (lead_finder_runs), 25 a page, Mine
// (default) or All. Per run: description (focus, type, city, depth or
// sweep radius), who, when, results, and how many of its businesses have
// been contacted since (a Sales record with its latest touch after the run
// started; matched by Google place id). Open shows the run's results in
// Mission Control; Run again repeats it (a sweep fills the form with the
// cost confirm, and isn't offered to Salespeople).

const PAGE = 25;

export default function SalesSearches({
  me,
  members,
  canSweep,
  onOpen,
  onRunAgain,
}: {
  me: TeamMember | null;
  members: TeamMember[];
  canSweep: boolean;
  onOpen: (runId: string) => void;
  onRunAgain: (run: LeadFinderRun) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [who, setWho] = useState<"mine" | "all">("mine");
  const [page, setPage] = useState(0);
  const [runs, setRuns] = useState<LeadFinderRun[] | null>(null);
  const [total, setTotal] = useState(0);
  const [contacted, setContacted] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Unknown";

  const load = useCallback(async () => {
    setError(null);
    setRuns(null);
    let q = supabase.from("lead_finder_runs").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (who === "mine" && me) q = q.eq("run_by", me.id);
    const { data, count, error: e } = await q.range(page * PAGE, page * PAGE + PAGE - 1);
    if (e) return setError(e.message);
    const list = (data ?? []) as LeadFinderRun[];
    setRuns(list);
    setTotal(count ?? 0);

    // Contacted since: the runs' businesses -> Sales records touched after the run.
    if (!list.length) return setContacted({});
    const byRun = new Map<string, Set<string>>();
    for (let from = 0; ; from += 1000) {
      const { data: res } = await supabase
        .from("lead_finder_results")
        .select("run_id, google_place_id")
        .in("run_id", list.map((r) => r.id))
        .range(from, from + 999);
      (res ?? []).forEach((r) => {
        if (!byRun.has(r.run_id)) byRun.set(r.run_id, new Set());
        byRun.get(r.run_id)!.add(r.google_place_id);
      });
      if ((res ?? []).length < 1000) break;
    }
    const places = Array.from(new Set(Array.from(byRun.values()).flatMap((s) => Array.from(s))));
    const touched = new Map<string, string>();
    for (let i = 0; i < places.length; i += 200) {
      const { data: leads } = await supabase
        .from("leads")
        .select("google_place_id, last_touch_at")
        .in("google_place_id", places.slice(i, i + 200))
        .in("source", SALES_SOURCES as unknown as string[])
        .not("last_touch_at", "is", null);
      (leads ?? []).forEach((l) => touched.set(l.google_place_id as string, l.last_touch_at as string));
    }
    const counts: Record<string, number> = {};
    list.forEach((r) => {
      const started = new Date(r.created_at).getTime();
      counts[r.id] = Array.from(byRun.get(r.id) ?? []).filter((p) => {
        const t = touched.get(p);
        return !!t && new Date(t).getTime() > started;
      }).length;
    });
    setContacted(counts);
  }, [supabase, who, page, me]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <main className="mc">
      <section className="panel list" aria-label="Searches">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Whose searches">
            {(["mine", "all"] as const).map((k) => (
              <button key={k} type="button" role="tab" className="tab" aria-selected={who === k} onClick={() => { setWho(k); setPage(0); }}>
                {k === "mine" ? "Mine" : "All"}
              </button>
            ))}
          </div>
          <div className="tools">
            <button type="button" className="btn" onClick={() => void load()}>Refresh</button>
          </div>
        </div>
        {error && (
          <div className="bar-msg">
            <p className="error">{error}</p>
          </div>
        )}
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Search</th>
                <th>Ran by</th>
                <th>When</th>
                <th>Results</th>
                <th title="Businesses from this search contacted after it ran">Contacted since</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs === null ? (
                <tr>
                  <td colSpan={6}><div className="empty-list">Loading…</div></td>
                </tr>
              ) : runs.length ? (
                runs.map((r) => {
                  const canRerun = r.kind === "search" || canSweep;
                  return (
                    <tr key={r.id} className="lead" onClick={() => onOpen(r.id)}>
                      <td>
                        <button type="button" className="name" onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}>
                          {describeSearch(bodyFromRun(r))}
                        </button>
                        <div className="meta">{r.kind === "sweep" ? "Area sweep" : "Quick search"}</div>
                      </td>
                      <td>{memberName(r.run_by)}</td>
                      <td style={{ whiteSpace: "nowrap" }}><LocalDateTime iso={r.created_at} /></td>
                      <td>
                        {r.status === "done"
                          ? r.result_count
                          : r.status === "running" || r.status === "queued"
                            ? "In flight"
                            : r.status === "cancelled"
                              ? `Cancelled (${r.result_count})`
                              : "Failed"}
                      </td>
                      <td>{contacted[r.id] ?? "…"}</td>
                      <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" className="btn" onClick={() => onOpen(r.id)}>Open</button>
                          {canRerun && (
                            <button type="button" className="btn" onClick={() => onRunAgain(r)}>Run again</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-list">{who === "mine" ? "You haven't run a search yet." : "No searches yet."}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="foot pager">
          <span>
            {total} search{total === 1 ? "" : "es"} · page {page + 1} of {pages}
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <button type="button" className="btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </span>
        </div>
      </section>
    </main>
  );
}
