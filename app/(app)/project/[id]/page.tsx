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
import Link from "next/link";
import DealDesk, { type DealDeskData } from "@/components/deals/DealDesk";
import ProjectDocuments from "@/components/deals/ProjectDocuments";
import { googleConfigured } from "@/lib/deals/google";
import { docsKeyConfigured } from "@/lib/deals/ai";
import type { ProjectLink } from "@/lib/deals/types";
import type { Stage } from "@/lib/theme";

// Deal Desk tab from Negotiation onward (or whenever a deal exists);
// Documents from Interested onward (every stage but Lost, or with links).
const DEAL_STAGES: Stage[] = ["Negotiation", "Signed", "In Progress", "Subscriber", "Complete"];

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; tab?: string; view?: string };
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

  const p = project as Project;
  const [deskData, links] = await Promise.all([loadDealDesk(supabase, p.id), loadLinks(supabase, p.id)]);
  const showDeal = DEAL_STAGES.includes(p.stage) || !!deskData?.deal;
  const showDocs = p.stage !== "Lost" || links.length > 0;
  const view = searchParams.view === "deal" && showDeal ? "deal" : searchParams.view === "docs" && showDocs ? "docs" : "overview";
  const tabHref = (v: string) => {
    const q = new URLSearchParams();
    if (searchParams.from) q.set("from", searchParams.from);
    if (searchParams.tab) q.set("tab", searchParams.tab);
    if (v !== "overview") q.set("view", v);
    const qs = q.toString();
    return `/project/${p.id}${qs ? `?${qs}` : ""}`;
  };
  const tabs = [
    { key: "overview", label: "Overview", show: true },
    { key: "deal", label: "Deal Desk", show: showDeal },
    { key: "docs", label: "Documents", show: showDocs },
  ].filter((t) => t.show);

  return (
    <div className="p-8">
      {tabs.length > 1 && (
        <nav className="mb-6 flex gap-1 border-b border-neutral-200">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                view === t.key ? "border-accent text-accent" : "border-transparent text-neutral-500 hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      {view === "deal" && deskData && currentMember && (
        <DealDesk
          projectId={p.id}
          data={deskData}
          members={(teamMembers ?? []) as TeamMember[]}
          me={currentMember}
          googleOk={{ proposal: googleConfigured("proposal"), sow: googleConfigured("sow") }}
          docsKeyOk={docsKeyConfigured()}
        />
      )}
      {view === "docs" && <ProjectDocuments projectId={p.id} links={links} />}
      {view === "overview" && (
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
      )}
    </div>
  );
}

async function loadDealDesk(
  supabase: ReturnType<typeof createClient>,
  projectId: string
): Promise<DealDeskData | null> {
  const [{ data: deal }, { data: settings }] = await Promise.all([
    supabase.from("deals").select("*").eq("project_id", projectId).neq("status", "void").maybeSingle(),
    supabase.from("deal_settings").select("*").eq("id", true).maybeSingle(),
  ]);
  if (!settings) return null;
  if (!deal) return { deal: null, items: [], docs: [], signatures: [], events: [], settings };
  const [{ data: items }, { data: docs }, { data: signatures }, { data: events }] = await Promise.all([
    supabase.from("deal_line_items").select("*").eq("deal_id", deal.id),
    supabase.from("deal_documents").select("*").eq("deal_id", deal.id).order("version", { ascending: false }),
    supabase
      .from("deal_signatures")
      .select(
        "id, deal_id, document_id, proposal_document_id, expires_at, revoked_at, viewed_at, signer_name, signer_title, signer_email, typed_signature, consent, consent_text, selections, content_hash, signed_at, ip, user_agent, pdf_path, fl_countersigned_by, fl_countersigner_name, fl_countersigner_title, fl_countersigned_at, final_pdf_path, created_at"
      )
      .eq("deal_id", deal.id)
      .order("created_at", { ascending: false }),
    supabase.from("deal_events").select("*").eq("deal_id", deal.id).order("created_at", { ascending: false }).limit(50),
  ]);
  return {
    deal,
    items: (items ?? []).map((i) => ({
      ...i,
      amount: Number(i.amount),
      overage_rate: i.overage_rate == null ? null : Number(i.overage_rate),
      hours_included: i.hours_included == null ? null : Number(i.hours_included),
    })),
    docs: docs ?? [],
    signatures: signatures ?? [],
    events: events ?? [],
    settings,
  };
}

async function loadLinks(supabase: ReturnType<typeof createClient>, projectId: string): Promise<ProjectLink[]> {
  const { data } = await supabase
    .from("project_links")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ProjectLink[];
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
