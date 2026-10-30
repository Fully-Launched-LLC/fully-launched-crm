"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ENTRY_TYPES,
  ENTRY_TYPE_LABELS,
  INACTIVE_PROJECT_STAGES,
} from "@/lib/timeclock";
import type { TimeEntryType } from "@/lib/types";
import type { ClockProject } from "@/components/clock/useTimeClock";

// Entry type + optional project, then Clock in. Used in the nav popover and
// on /clock, so it's sized to fit a ~320px wide window.
export default function ClockInForm({
  busy,
  onClockIn,
}: {
  busy: boolean;
  onClockIn: (type: TimeEntryType, projectId: string | null) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [type, setType] = useState<TimeEntryType>("project");
  const [projects, setProjects] = useState<ClockProject[] | null>(null);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<ClockProject | null>(null);
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("projects")
      .select("id, client_name")
      .not("stage", "in", `(${INACTIVE_PROJECT_STAGES.map((s) => `"${s}"`).join(",")})`)
      .order("client_name")
      .then(({ data }) => {
        if (!cancelled) setProjects((data ?? []) as ClockProject[]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects ?? [];
    return q ? list.filter((p) => p.client_name.toLowerCase().includes(q)) : list;
  }, [projects, query]);

  function pick(p: ClockProject | null) {
    setProject(p);
    setQuery("");
    setListOpen(false);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-neutral-500">Type</p>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {ENTRY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              aria-pressed={type === t}
              className={`rounded-md border px-2 py-1.5 text-sm font-medium ${
                type === t
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              {ENTRY_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        {type === "management" && (
          <p className="mt-1 text-xs text-neutral-500">
            Management time counts toward pay once an Admin approves it.
          </p>
        )}
      </div>

      <div className="relative">
        <p className="text-xs font-medium text-neutral-500">Project (optional)</p>
        {project && !listOpen ? (
          <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
            <span className="truncate text-foreground">{project.client_name}</span>
            <button
              type="button"
              onClick={() => pick(null)}
              className="shrink-0 text-xs text-neutral-500 hover:text-foreground"
            >
              Clear
            </button>
          </div>
        ) : (
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setListOpen(true);
            }}
            onFocus={() => setListOpen(true)}
            // Delay so a click on a list item lands before the list closes.
            onBlur={() => setTimeout(() => setListOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setListOpen(false);
              if (e.key === "Enter" && matches[0]) {
                e.preventDefault();
                pick(matches[0]);
              }
            }}
            placeholder={projects ? "Search active projects" : "Loading projects..."}
            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        )}
        {listOpen && projects && (
          <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
            <li>
              <button
                type="button"
                onClick={() => pick(null)}
                className="w-full px-2 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-50"
              >
                No project
              </button>
            </li>
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => pick(p)}
                  className="w-full truncate px-2 py-1.5 text-left text-sm text-foreground hover:bg-neutral-50"
                >
                  {p.client_name}
                </button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-neutral-500">No matching projects</li>
            )}
          </ul>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => onClockIn(type, project?.id ?? null)}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
      >
        {busy ? "Clocking in..." : "Clock in"}
      </button>
    </div>
  );
}
