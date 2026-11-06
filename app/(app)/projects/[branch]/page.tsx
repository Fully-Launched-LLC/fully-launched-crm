import { notFound } from "next/navigation";
import {
  isBranchSlug,
  branchLabel,
  branchValue,
  type BranchSlug,
} from "@/lib/branches";
import type { Project, TeamMember } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import ProjectsTable from "@/components/ProjectsTable";
import ProjectsKanban from "@/components/kanban/ProjectsKanban";
import ViewToggle from "@/components/ViewToggle";

export default async function ProjectsPage({
  params,
  searchParams,
}: {
  params: { branch: string };
  searchParams: { view?: string; lost?: string };
}) {
  if (!isBranchSlug(params.branch)) {
    notFound();
  }

  const slug = params.branch as BranchSlug;
  const label = branchLabel(slug);
  const branch = branchValue(slug);
  // Kanban is the default; Table is opt-in via ?view=table
  const view = searchParams.view === "table" ? "table" : "kanban";

  const supabase = createClient();

  let projectsQuery = supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (branch) {
    projectsQuery = projectsQuery.eq("branch", branch);
  }

  const [{ data: projects }, { data: teamMembers }] = await Promise.all([
    projectsQuery,
    supabase.from("team_members").select("*").order("name"),
  ]);

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{label}</h1>
        <div className="ml-auto">
          <ViewToggle tab={slug} current={view} />
        </div>
      </div>

      <div className="mt-6">
        {view === "kanban" ? (
          <ProjectsKanban
            initialProjects={(projects ?? []) as Project[]}
            teamMembers={(teamMembers ?? []) as TeamMember[]}
            tab={slug}
            showLost={searchParams.lost === "1"}
          />
        ) : (
          <ProjectsTable
            initialProjects={(projects ?? []) as Project[]}
            teamMembers={(teamMembers ?? []) as TeamMember[]}
            fixedBranch={branch}
          />
        )}
      </div>
    </div>
  );
}
