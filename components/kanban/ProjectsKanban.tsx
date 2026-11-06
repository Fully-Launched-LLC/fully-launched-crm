"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_STAGE, STAGES, type Stage } from "@/lib/theme";
import type { Project, TeamMember } from "@/lib/types";
import { branchValue, type BranchSlug } from "@/lib/branches";
import { projectDetailHref } from "@/lib/projects";
import KanbanColumn from "@/components/kanban/KanbanColumn";
import KanbanCard, {
  KanbanCardPreview,
  type OwnerPill,
} from "@/components/kanban/KanbanCard";
import { memberColors } from "@/lib/team";

function byUpdatedDesc(a: Project, b: Project) {
  return Date.parse(b.updated_at) - Date.parse(a.updated_at);
}

export default function ProjectsKanban({
  initialProjects,
  teamMembers,
  tab,
  showLost,
}: {
  initialProjects: Project[];
  teamMembers: TeamMember[];
  tab: BranchSlug;
  // Lost column is hidden unless the URL has ?lost=1 ("Show lost" toggle).
  showLost: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // True from drag start until just after drop, so the click that can fire
  // on pointerup doesn't also navigate to the detail page.
  const draggingRef = useRef(false);

  const sensors = useSensors(
    // 5px threshold: a plain click opens the card, only a real drag moves it
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Space only — Enter is left for the card's link (open detail page)
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    })
  );

  const membersById = useMemo(
    () => new Map(teamMembers.map((m) => [m.id, m.name])),
    [teamMembers]
  );
  const colors = useMemo(() => memberColors(teamMembers), [teamMembers]);

  function owners(p: Project): OwnerPill[] {
    return p.owner.flatMap((id) => {
      const name = membersById.get(id);
      return name ? [{ id, name, color: colors.get(id)! }] : [];
    });
  }

  // Grouped + sorted in one place, so there's no unsorted render path.
  const columns = useMemo(() => {
    const grouped = new Map<Stage, Project[]>(STAGES.map((s) => [s, []]));
    for (const p of projects) grouped.get(p.stage)?.push(p);
    grouped.forEach((list) => list.sort(byUpdatedDesc));
    return grouped;
  }, [projects]);

  const visibleStages = showLost
    ? STAGES
    : STAGES.filter((s) => s !== "Lost");
  const lostCount = columns.get("Lost")?.length ?? 0;

  // Keeps every other query param (view, from, ...) and only flips lost.
  function toggleLost() {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (showLost) params.delete("lost");
    else params.set("lost", "1");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const activeProject = activeId
    ? projects.find((p) => p.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    draggingRef.current = true;
    setActiveId(String(event.active.id));
  }

  function endDrag() {
    setActiveId(null);
    setTimeout(() => {
      draggingRef.current = false;
    }, 0);
  }

  async function handleDragEnd(event: DragEndEvent) {
    endDrag();
    const id = String(event.active.id);
    const stage = event.over?.id as Stage | undefined;
    const project = projects.find((p) => p.id === id);
    if (!project || !stage || project.stage === stage) return;

    // Optimistic: move now and bump updated_at so it lands at the top of the
    // new column; the DB trigger sets the real value, synced back below.
    const previous = projects;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, stage, updated_at: new Date().toISOString() }
          : p
      )
    );

    const { data, error } = await supabase
      .from("projects")
      .update({ stage })
      .eq("id", id)
      .select("updated_at")
      .single();

    if (error || !data) {
      setProjects(previous);
      setError(error?.message ?? "Could not update stage");
      return;
    }
    setError(null);
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, updated_at: data.updated_at } : p))
    );
  }

  // Same insert as the Table's "+ New Project": a blank Interested project in
  // the current tab's branch (none on the All tab), opened right away like
  // Duplicate. from/tab bring Back to this Kanban tab.
  async function addProject() {
    setCreating(true);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        client_name: "New Project",
        branch: branchValue(tab),
        stage: DEFAULT_STAGE,
      })
      .select("id")
      .single();

    if (error || !data) {
      setCreating(false);
      setError(error?.message ?? "Could not create project");
      return;
    }
    router.push(projectDetailHref(data.id, "kanban", tab));
    router.refresh();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLost}
            aria-pressed={showLost}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            {showLost ? "Hide lost" : `Show lost (${lostCount})`}
          </button>
          <button
            type="button"
            onClick={addProject}
            disabled={creating}
            className="rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground disabled:opacity-50"
          >
            {creating ? "Creating…" : "+ New Project"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={endDrag}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {visibleStages.map((stage) => {
            const list = columns.get(stage) ?? [];
            return (
              <KanbanColumn key={stage} stage={stage} count={list.length}>
                {list.map((p) => (
                  <KanbanCard
                    key={p.id}
                    project={p}
                    owners={owners(p)}
                    showBranch={tab === "all"}
                    href={projectDetailHref(p.id, "kanban", tab)}
                    isClickSuppressed={() => draggingRef.current}
                  />
                ))}
              </KanbanColumn>
            );
          })}
        </div>

        <DragOverlay>
          {activeProject && (
            <KanbanCardPreview
              project={activeProject}
              owners={owners(activeProject)}
              showBranch={tab === "all"}
            />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
