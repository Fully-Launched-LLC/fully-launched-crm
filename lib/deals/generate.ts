import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { generateContent, redactPrices, type AiInput, type ProposalContent, type SowContent, PROPOSAL_SECTIONS, SOW_SECTIONS } from "@/lib/deals/ai";
import { copyFile, docUrl, ensureClientFolders, fileMeta, fillDocument, safeName } from "@/lib/deals/google";
import { proposalPlan, sowPlan } from "@/lib/deals/render";
import { companyName, latestDoc, type DealBundle } from "@/lib/deals/server";
import type { DealDocument, SectionFlags } from "@/lib/deals/types";

type Db = ReturnType<typeof createClient>;

const MEETING_CHARS = 12000;

// Up to the 5 most recent Granola meetings of the lead, ~12k characters in
// all, prices scrubbed.
async function meetingsFor(db: Db, leadId: string | null): Promise<AiInput["meetings"]> {
  if (!leadId) return [];
  const { data } = await db
    .from("meeting_notes")
    .select("title, started_at, summary_md")
    .eq("lead_id", leadId)
    .order("started_at", { ascending: false })
    .limit(5);
  let budget = MEETING_CHARS;
  const out: AiInput["meetings"] = [];
  for (const m of data ?? []) {
    if (budget <= 0) break;
    const notes = (redactPrices(m.summary_md) ?? "").slice(0, budget);
    budget -= notes.length;
    out.push({ title: redactPrices(m.title), date: m.started_at?.slice(0, 10) ?? null, notes });
  }
  return out;
}

export function aiInputFor(b: DealBundle, kind: "proposal" | "sow", meetings: AiInput["meetings"]): AiInput {
  return {
    kind,
    company: {
      name: companyName(b),
      contact_name: b.lead?.contact_name ?? b.project.contact_name,
      category: b.lead?.category ?? null,
      city: b.lead?.city ?? null,
      website: b.lead?.website ?? null,
      notes: redactPrices(b.lead?.notes ?? b.project.notes),
    },
    meetings,
    // No amounts, no overage rates: only what the words need.
    line_items: b.items.map((i) => ({
      id: i.id,
      branch: i.branch,
      label: redactPrices(i.label) ?? "",
      tier_name: redactPrices(i.tier_name),
      kind: i.kind,
      description: redactPrices(i.description),
      hours_included: i.hours_included,
    })),
    dates: {
      date_issued: b.deal.date_issued,
      target_start: b.deal.target_start,
      target_launch: b.deal.target_launch,
    },
  };
}

// Ensure Clients/{Company} (+ Internal) exist; store on the deal; add the
// drive_folder link once.
export async function ensureDealFolder(db: Db, b: DealBundle) {
  const folders = await ensureClientFolders(companyName(b));
  if (b.deal.drive_folder_id !== folders.folderId) {
    await db
      .from("deals")
      .update({ drive_folder_id: folders.folderId, drive_folder_url: folders.folderUrl })
      .eq("id", b.deal.id);
  }
  const { data: existing } = await db
    .from("project_links")
    .select("id")
    .eq("project_id", b.project.id)
    .eq("kind", "drive_folder")
    .eq("drive_file_id", folders.folderId)
    .maybeSingle();
  if (!existing) {
    await db.from("project_links").insert({
      project_id: b.project.id,
      deal_id: b.deal.id,
      kind: "drive_folder",
      label: `${companyName(b)} folder`,
      url: folders.folderUrl,
      drive_file_id: folders.folderId,
      source: "system",
    });
  }
  return folders;
}

export async function generateDocument(args: {
  db: Db;
  bundle: DealBundle;
  kind: "proposal" | "sow";
  section?: string;
  restoreFrom?: DealDocument;
}): Promise<DealDocument> {
  const { db, bundle: b, kind, section, restoreFrom } = args;
  const templateId =
    (kind === "proposal" ? process.env.GOOGLE_DOCS_PROPOSAL_TEMPLATE_ID! : process.env.GOOGLE_DOCS_SOW_TEMPLATE_ID!).trim();

  // 1. Content: restore an old version's AI text, regenerate one section, or
  //    generate everything.
  const prev = latestDoc(b.docs, kind);
  let content: Record<string, unknown>;
  let model: string | null = null;
  let manual: string[] = [];
  let source: DealDocument["source"] = "claude";
  if (restoreFrom) {
    content = restoreFrom.content_json;
    model = restoreFrom.model;
    source = "restore";
  } else {
    const meetings = await meetingsFor(db, b.deal.lead_id);
    const ai = await generateContent(aiInputFor(b, kind, meetings));
    model = ai.model;
    manual = ai.needsManualEdit;
    if (section && prev) {
      const allowed = kind === "proposal" ? PROPOSAL_SECTIONS : SOW_SECTIONS;
      if (!allowed.includes(section)) throw new Error(`Unknown section ${section}`);
      content = { ...prev.content_json, [section]: ai.content[section] };
      manual = manual.filter((k) => k === section);
    } else {
      content = ai.content;
    }
  }

  // 2. Drive: folder, copy of the master.
  const folders = await ensureDealFolder(db, b);
  const version = (prev?.version ?? 0) + 1;
  const company = companyName(b);
  const name = `${safeName(company)} - ${kind === "proposal" ? "Proposal" : "SOW"} v${version}`;
  const template = await fileMeta(templateId);
  const docId = await copyFile(templateId, name, folders.folderId);

  // 3. Fill it.
  const plan =
    kind === "proposal"
      ? proposalPlan({ deal: b.deal, clientName: company, items: b.items, content: content as ProposalContent })
      : sowPlan({ deal: b.deal, clientName: company, items: b.items, content: content as SowContent, settings: b.settings });
  const { leftovers } = await fillDocument(docId, plan);

  const flags: SectionFlags = {};
  if (manual.length) flags.needs_manual_edit = manual;
  if (leftovers.length) flags.leftovers = leftovers;

  // 4. Record the version (user session: the triggers reset an approved deal).
  const { data: doc, error } = await db
    .from("deal_documents")
    .insert({
      deal_id: b.deal.id,
      kind,
      version,
      content_json: content,
      google_doc_id: docId,
      google_doc_url: docUrl(docId),
      template_doc_id: templateId,
      template_modified_at: template.modifiedTime ?? null,
      source,
      model,
      section_flags: flags,
    })
    .select("*")
    .single();
  if (error || !doc) throw new Error(error?.message ?? "Could not save the document version");

  await db.from("project_links").insert({
    project_id: b.project.id,
    deal_id: b.deal.id,
    document_id: doc.id,
    kind: kind === "proposal" ? "proposal_doc" : "sow_doc",
    label: name,
    url: docUrl(docId),
    drive_file_id: docId,
    source: "system",
  });
  return doc as DealDocument;
}
