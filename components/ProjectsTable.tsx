"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isOverdue, type Project, type TeamMember } from "@/lib/types";
import {
  BRANCHES,
  BRANCH_COLORS,
  SOURCES,
  DEFAULT_STAGE,
  STAGES,
  STAGE_COLORS,
  type Branch,
  type Stage,
} from "@/lib/theme";
import ColumnHeader, { type ColumnFilter } from "@/components/table/ColumnHeader";
import TextCell from "@/components/table/TextCell";
import DateCell from "@/components/table/DateCell";
import BadgeSelectCell from "@/components/table/BadgeSelectCell";
import MultiSelectCell from "@/components/table/MultiSelectCell";
import { branchSlug } from "@/lib/branches";
import { projectDetailHref } from "@/lib/projects";
import { branchChangePatch } from "@/lib/channels";
import ChannelsField from "@/components/ChannelsField";
import RemoveFromPipelineDialog from "@/components/RemoveFromPipelineDialog";

type SortDir = "asc" | "desc";

type Column = {
  id: string;
  label: string;
  filter?: ColumnFilter;
  getSortValue: (p: Project) => string | number;
  matchesFilter: (p: Project, value: string | string[]) => boolean;
  render: (p: Project) => React.ReactNode;
};

const currencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Source doesn't get semantic colors like Branch/Stage — flat neutral pill.
const SOURCE_COLORS = Object.fromEntries(
  SOURCES.map((s) => [s, "bg-neutral-100 text-neutral-700 border border-neutral-300"])
);

function textMatch(text: string | null, value: string | string[]) {
  const query = (value as string).trim().toLowerCase();
  if (!query) return true;
  return (text ?? "").toLowerCase().includes(query);
}

function enumMatch(current: string | null, value: string | string[]) {
  const selected = value as string[];
  if (selected.length === 0) return true;
  return current ? selected.includes(current) : false;
}

function memberMatch(ids: string[], value: string | string[]) {
  const selected = value as string[];
  if (selected.length === 0) return true;
  return ids.some((id) => selected.includes(id));
}

export default function ProjectsTable({
  initialProjects,
  teamMembers,
  fixedBranch,
}: {
  initialProjects: Project[];
  teamMembers: TeamMember[];
  fixedBranch: Branch | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<{ column: string; dir: SortDir } | null>(
    null
  );
  const [filters, setFilters] = useState<Record<string, string | string[]>>({
    name: "",
    branch: [],
    channels: "",
    contact: "",
    email: "",
    phone: "",
    stage: [],
    owner: [],
    salesperson: [],
    source: [],
    buildValue: "",
    subscriptionValue: "",
    endDate: "",
    targetDate: "",
    notes: "",
  });

  const memberOptions = useMemo(
    () => teamMembers.map((m) => ({ value: m.id, label: m.name })),
    [teamMembers]
  );
  const membersById = useMemo(
    () => new Map(teamMembers.map((m) => [m.id, m.name])),
    [teamMembers]
  );

  function memberSortValue(ids: string[]) {
    return ids
      .map((id) => membersById.get(id) ?? "")
      .sort()
      .join(", ");
  }

  // Moving to Lost opens Remove from pipeline; Cancel leaves the stage.
  const [removing, setRemoving] = useState<Project | null>(null);

  async function updateProject(id: string, patch: Partial<Project>) {
    const previous = projects;
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
    const { error } = await supabase.from("projects").update(patch).eq("id", id);
    if (error) {
      setProjects(previous);
      setError(error.message);
    } else {
      setError(null);
    }
  }

  // Creates a blank Interested project in this tab's branch and opens it, same
  // as Duplicate — the user fills it in on the Manage Project page. The
  // from/tab params bring Back to this Table tab.
  async function addRow() {
    setCreating(true);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        client_name: "New Project",
        branch: fixedBranch,
        stage: DEFAULT_STAGE,
      })
      .select("id")
      .single();

    if (error || !data) {
      setCreating(false);
      setError(error?.message ?? "Could not create project");
      return;
    }
    router.push(
      projectDetailHref(
        data.id,
        "table",
        fixedBranch ? branchSlug(fixedBranch) : "all"
      )
    );
    router.refresh();
  }

  const columns: Column[] = useMemo(
    () => [
      {
        id: "name",
        label: "Company",
        filter: { type: "text" },
        getSortValue: (p) => p.client_name,
        matchesFilter: (p, v) => textMatch(p.client_name, v),
        render: (p) => (
          <TextCell
            value={p.client_name}
            onCommit={(v) => updateProject(p.id, { client_name: v })}
          />
        ),
      },
      {
        id: "branch",
        label: "Branch",
        filter: {
          type: "enum",
          options: BRANCHES.map((b) => ({ value: b, label: b })),
        },
        getSortValue: (p) => p.branch ?? "",
        matchesFilter: (p, v) => enumMatch(p.branch, v),
        render: (p) => (
          <BadgeSelectCell
            value={p.branch}
            options={BRANCHES}
            colors={BRANCH_COLORS}
            onCommit={(v) =>
              updateProject(p.id, branchChangePatch(p, v as Branch))
            }
          />
        ),
      },
      {
        id: "channels",
        label: "Channels",
        filter: { type: "text" },
        getSortValue: (p) => (p.channels ?? []).join(", "),
        // Text search that matches any channel on the row.
        matchesFilter: (p, v) => textMatch((p.channels ?? []).join(" "), v),
        render: (p) => (
          <ChannelsField
            branch={p.branch}
            value={p.channels}
            onCommit={(channels) => updateProject(p.id, { channels })}
          />
        ),
      },
      {
        id: "contact",
        label: "Contact Name",
        filter: { type: "text" },
        getSortValue: (p) => p.contact_name ?? "",
        matchesFilter: (p, v) => textMatch(p.contact_name, v),
        render: (p) => (
          <TextCell
            value={p.contact_name}
            onCommit={(v) => updateProject(p.id, { contact_name: v })}
          />
        ),
      },
      {
        id: "email",
        label: "Email",
        filter: { type: "text" },
        getSortValue: (p) => p.email ?? "",
        matchesFilter: (p, v) => textMatch(p.email, v),
        render: (p) => (
          <TextCell
            type="email"
            value={p.email}
            onCommit={(v) => updateProject(p.id, { email: v })}
          />
        ),
      },
      {
        id: "phone",
        label: "Phone",
        filter: { type: "text" },
        getSortValue: (p) => p.phone ?? "",
        matchesFilter: (p, v) => textMatch(p.phone, v),
        render: (p) => (
          <TextCell
            type="tel"
            value={p.phone}
            onCommit={(v) => updateProject(p.id, { phone: v })}
          />
        ),
      },
      {
        id: "stage",
        label: "Stage",
        filter: {
          type: "enum",
          options: STAGES.map((s) => ({ value: s, label: s })),
        },
        getSortValue: (p) => STAGES.indexOf(p.stage),
        matchesFilter: (p, v) => enumMatch(p.stage, v),
        render: (p) => (
          <BadgeSelectCell
            value={p.stage}
            options={STAGES}
            colors={STAGE_COLORS}
            onCommit={(v) =>
              v === "Lost" ? setRemoving(p) : updateProject(p.id, { stage: v as Stage })
            }
          />
        ),
      },
      {
        id: "lostReason",
        label: "Lost Reason",
        getSortValue: () => 0,
        matchesFilter: () => true,
        render: (p) =>
          p.stage === "Lost" ? (
            <TextCell
              value={p.lost_reason}
              onCommit={(v) => updateProject(p.id, { lost_reason: v })}
            />
          ) : (
            <span className="block px-1.5 py-1 text-neutral-300">—</span>
          ),
      },
      {
        id: "owner",
        label: "Owner",
        filter: { type: "enum", options: memberOptions },
        getSortValue: (p) => memberSortValue(p.owner),
        matchesFilter: (p, v) => memberMatch(p.owner, v),
        render: (p) => (
          <MultiSelectCell
            teamMembers={teamMembers}
            selectedIds={p.owner}
            onCommit={(ids) => updateProject(p.id, { owner: ids })}
          />
        ),
      },
      {
        id: "salesperson",
        label: "Salesperson",
        filter: { type: "enum", options: memberOptions },
        getSortValue: (p) => memberSortValue(p.salesperson),
        matchesFilter: (p, v) => memberMatch(p.salesperson, v),
        render: (p) => (
          <MultiSelectCell
            teamMembers={teamMembers}
            selectedIds={p.salesperson}
            onCommit={(ids) => updateProject(p.id, { salesperson: ids })}
          />
        ),
      },
      {
        id: "source",
        label: "Source",
        filter: {
          type: "enum",
          options: SOURCES.map((s) => ({ value: s, label: s })),
        },
        getSortValue: (p) => p.source ?? "",
        matchesFilter: (p, v) => enumMatch(p.source, v),
        render: (p) => (
          <BadgeSelectCell
            value={p.source}
            options={SOURCES}
            colors={SOURCE_COLORS}
            onCommit={(v) => updateProject(p.id, { source: v })}
          />
        ),
      },
      {
        id: "targetDate",
        label: "Target Date",
        filter: { type: "text" },
        getSortValue: (p) => (p.target_date ? new Date(p.target_date).getTime() : 0),
        matchesFilter: (p, v) =>
          textMatch(
            p.target_date
              ? new Date(`${p.target_date}T00:00:00`).toLocaleDateString()
              : null,
            v
          ),
        render: (p) => (
          <DateCell
            value={p.target_date}
            overdue={isOverdue(p)}
            onCommit={(v) => updateProject(p.id, { target_date: v })}
          />
        ),
      },
      {
        id: "endDate",
        label: "End Date",
        filter: { type: "text" },
        getSortValue: (p) => (p.end_date ? new Date(p.end_date).getTime() : 0),
        matchesFilter: (p, v) =>
          textMatch(
            p.end_date
              ? new Date(`${p.end_date}T00:00:00`).toLocaleDateString()
              : null,
            v
          ),
        render: (p) => (
          <DateCell
            value={p.end_date}
            onCommit={(v) => updateProject(p.id, { end_date: v })}
          />
        ),
      },
      {
        id: "build",
        label: "Build",
        getSortValue: (p) => (p.build ? 1 : 0),
        matchesFilter: () => true,
        render: (p) => (
          <input
            type="checkbox"
            checked={p.build}
            onChange={(e) => updateProject(p.id, { build: e.target.checked })}
            className="ml-2 h-4 w-4"
          />
        ),
      },
      {
        // Editable only while Build is on, same as the Manage Project page.
        id: "buildValue",
        label: "Build Value",
        filter: { type: "text" },
        getSortValue: (p) => (p.build ? p.build_value ?? -1 : -1),
        matchesFilter: (p, v) =>
          textMatch(p.build && p.build_value != null ? String(p.build_value) : null, v),
        render: (p) =>
          p.build ? (
            <TextCell
              type="number"
              value={p.build_value != null ? String(p.build_value) : null}
              displayValue={
                p.build_value != null ? currencyFormat.format(p.build_value) : undefined
              }
              onCommit={(v) =>
                updateProject(p.id, { build_value: v === "" ? null : Number(v) })
              }
            />
          ) : (
            <span className="px-1.5 text-sm text-neutral-400">—</span>
          ),
      },
      {
        id: "subscription",
        label: "Subscription",
        getSortValue: (p) => (p.subscription ? 1 : 0),
        matchesFilter: () => true,
        render: (p) => (
          <input
            type="checkbox"
            checked={p.subscription}
            onChange={(e) =>
              updateProject(p.id, { subscription: e.target.checked })
            }
            className="ml-2 h-4 w-4"
          />
        ),
      },
      {
        // Editable only while Subscription is on, same as the Manage Project page.
        id: "subscriptionValue",
        label: "Sub Value ($/mo)",
        filter: { type: "text" },
        getSortValue: (p) =>
          p.subscription ? p.subscription_value ?? -1 : -1,
        matchesFilter: (p, v) =>
          textMatch(
            p.subscription && p.subscription_value != null
              ? String(p.subscription_value)
              : null,
            v
          ),
        render: (p) =>
          p.subscription ? (
            <TextCell
              type="number"
              value={p.subscription_value != null ? String(p.subscription_value) : null}
              displayValue={
                p.subscription_value != null
                  ? `${currencyFormat.format(p.subscription_value)}/mo`
                  : undefined
              }
              onCommit={(v) =>
                updateProject(p.id, {
                  subscription_value: v === "" ? null : Number(v),
                })
              }
            />
          ) : (
            <span className="px-1.5 text-sm text-neutral-400">—</span>
          ),
      },
      {
        id: "notes",
        label: "Notes",
        filter: { type: "text" },
        getSortValue: (p) => p.notes ?? "",
        matchesFilter: (p, v) => textMatch(p.notes, v),
        render: (p) => (
          <TextCell
            value={p.notes}
            onCommit={(v) => updateProject(p.id, { notes: v })}
          />
        ),
      },
      {
        id: "manage",
        label: "",
        getSortValue: () => 0,
        matchesFilter: () => true,
        render: (p) => (
          <Link
            href={projectDetailHref(
              p.id,
              "table",
              fixedBranch ? branchSlug(fixedBranch) : "all"
            )}
            className="whitespace-nowrap rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Manage Project
          </Link>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamMembers, memberOptions, fixedBranch]
  );

  const rows = useMemo(() => {
    let result = projects.filter((p) =>
      columns.every((col) => col.matchesFilter(p, filters[col.id] ?? ""))
    );
    if (sort) {
      const col = columns.find((c) => c.id === sort.column)!;
      result = [...result].sort((a, b) => {
        const av = col.getSortValue(a);
        const bv = col.getSortValue(b);
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv));
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [projects, filters, sort, columns]);

  function toggleSort(columnId: string) {
    setSort((prev) => {
      if (!prev || prev.column !== columnId) return { column: columnId, dir: "asc" };
      if (prev.dir === "asc") return { column: columnId, dir: "desc" };
      return null;
    });
  }

  return (
    <div>
      {removing && (
        <RemoveFromPipelineDialog
          projectId={removing.id}
          clientName={removing.client_name}
          onCancel={() => setRemoving(null)}
          onDone={() => {
            const id = removing.id;
            setRemoving(null);
            setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, stage: "Lost" } : p)));
            router.refresh();
          }}
        />
      )}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          {rows.length} of {projects.length} project{projects.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={addRow}
          disabled={creating}
          className="rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground disabled:opacity-50"
        >
          {creating ? "Creating…" : "+ New Project"}
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full min-w-[2100px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50">
              {columns.map((col) => (
                <th
                  key={col.id}
                  className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500"
                >
                  {col.filter || col.label ? (
                    <ColumnHeader
                      label={col.label}
                      sortDir={sort?.column === col.id ? sort.dir : null}
                      onSortToggle={() => toggleSort(col.id)}
                      filter={col.filter}
                      filterValue={filters[col.id] ?? ""}
                      onFilterChange={(v) =>
                        setFilters((prev) => ({ ...prev, [col.id]: v }))
                      }
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-neutral-100 last:border-0">
                {columns.map((col) => (
                  <td key={col.id} className="px-1 py-1 align-top">
                    {col.render(p)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-neutral-400"
                >
                  {projects.length === 0
                    ? "No projects yet. Click + New Project to add one."
                    : "No projects match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
