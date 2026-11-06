import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Project, ProjectTask, TeamMember } from "@/lib/types";
import ProjectDetail from "@/components/ProjectDetail";
import { projectOrigin } from "@/lib/projects";
import { getCurrentTeamMember } from "@/lib/auth";
import { canSendInvoices } from "@/lib/billing";
import { stripeDashboardBase } from "@/lib/stripe";
import type { Call } from "@/lib/calls";
import type { ProjectLeadHistory } from "@/components/LeadHistory";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; tab?: string };
}) {
  const supabase = createClient();

  const [
    { data: project },
    { data: teamMembers },
    { data: tasks },
    currentMember,
    { data: callLinks },
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("team_members").select("*").order("name"),
    supabase
      .from("project_tasks")
      .select("*")
      .eq("project_id", params.id)
      .order("due_date", { ascending: true, nullsFirst: false }),
    getCurrentTeamMember(),
    // Cal.com calls linked to this project (migration 012).
    supabase.from("call_projects").select("call:calls(*)").eq("project_id", params.id),
  ]);

  if (!project) {
    notFound();
  }

  const leadHistory = await loadLeadHistory(
    supabase,
    project as Project
  );
  const calls = ((callLinks ?? []) as unknown as { call: Call | null }[])
    .map((l) => l.call)
    .filter((c): c is Call => c !== null);

  return (
    <div className="p-8">
      <ProjectDetail
        initialProject={project as Project}
        teamMembers={(teamMembers ?? []) as TeamMember[]}
        initialTasks={(tasks ?? []) as ProjectTask[]}
        back={projectOrigin(searchParams.from, searchParams.tab)}
        // UI only. The real gate is the projects "admin delete" RLS policy
        // (Admin only; was Admin or Manager before).
        canDelete={currentMember?.role === "Admin"}
        // UI only — the invoice route re-checks the role server-side.
        canInvoice={canSendInvoices(currentMember?.role)}
        stripeDashboardBase={stripeDashboardBase()}
        currentMemberId={currentMember?.id ?? null}
        calls={calls}
        leadHistory={leadHistory}
      />
    </div>
  );
}

const LEAD_COLUMNS =
  "id, company, source, source_detail, found_by, created_at, audit";

// The company's business record (Leads tab): projects.lead_id, else the
// older link leads.project_id = this project. Plus the touch timeline and
// any other projects that share the same lead_id (same company).
async function loadLeadHistory(
  supabase: ReturnType<typeof createClient>,
  project: Project
): Promise<ProjectLeadHistory | null> {
  const [{ data: leads }, { data: otherProjects }] = await Promise.all([
    project.lead_id
      ? supabase.from("leads").select(LEAD_COLUMNS).eq("id", project.lead_id)
      : supabase.from("leads").select(LEAD_COLUMNS).eq("project_id", project.id),
    project.lead_id
      ? supabase
          .from("projects")
          .select("id, client_name, branch, stage")
          .eq("lead_id", project.lead_id)
          .neq("id", project.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  if (!leads?.length) return null;

  const { data: touches } = await supabase
    .from("lead_touches")
    .select("id, lead_id, channel, direction, outcome, summary, touched_by, touched_at")
    .in("lead_id", leads.map((l) => l.id))
    .order("touched_at", { ascending: false });

  return {
    leads: leads as ProjectLeadHistory["leads"],
    touches: (touches ?? []) as ProjectLeadHistory["touches"],
    otherProjects: (otherProjects ?? []) as ProjectLeadHistory["otherProjects"],
  };
}
