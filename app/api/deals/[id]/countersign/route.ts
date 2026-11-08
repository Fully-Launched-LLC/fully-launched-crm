import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildSignaturePackage } from "@/lib/deals/pdf";
import { googleConfigured, uploadPdf } from "@/lib/deals/google";
import { logDealEvent } from "@/lib/deals/events";
import { companyName, downloadFromStorage, jsonError, loadDeal, requireMember, uploadToStorage } from "@/lib/deals/server";
import { STORAGE_URL_PREFIX, type DealDocument, type DealSignature } from "@/lib/deals/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Admin only. POST { name, title } -> final-v{n}.pdf with both signatures.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireMember("admin");
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { name?: string; title?: string };
  const name = body.name?.trim();
  const title = body.title?.trim();
  if (!name || !title) return jsonError("Name and title are required");

  const db = createClient();
  const bundle = await loadDeal(db, params.id);
  if (!bundle) return jsonError("Deal not found", 404);
  if (bundle.deal.status !== "signed") return jsonError("Only a signed deal can be countersigned");

  const admin = createAdminClient();
  const { data: sigRow } = await admin
    .from("deal_signatures")
    .select("*")
    .eq("deal_id", bundle.deal.id)
    .not("signed_at", "is", null)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sig = sigRow as DealSignature | null;
  if (!sig?.signed_at) return jsonError("No client signature found");

  const docs = bundle.docs;
  const sow = docs.find((d) => d.id === sig.document_id) as DealDocument | undefined;
  const proposal = docs.find((d) => d.id === sig.proposal_document_id) as DealDocument | undefined;
  if (!sow?.frozen_pdf_path || !proposal?.frozen_pdf_path) return jsonError("The signed documents are missing");

  const at = new Date().toISOString();
  const [proposalPdf, sowPdf] = await Promise.all([
    downloadFromStorage(proposal.frozen_pdf_path),
    downloadFromStorage(sow.frozen_pdf_path),
  ]);
  const client = companyName(bundle);
  const pdf = await buildSignaturePackage({
    proposalPdf,
    sowPdf,
    items: bundle.items,
    selections: sig.selections ?? { items: [] },
    signer: {
      name: sig.signer_name ?? "",
      title: sig.signer_title ?? "",
      email: sig.signer_email ?? "",
      typed: sig.typed_signature ?? "",
      signedAt: sig.signed_at,
      ip: sig.ip ?? "",
      userAgent: sig.user_agent ?? "",
      consentText: sig.consent_text ?? "",
    },
    countersign: { name, title, at },
    audit: {
      dealId: bundle.deal.id,
      clientName: client,
      proposal: { version: proposal.version, hash: proposal.content_hash },
      sow: { version: sow.version, hash: sow.content_hash },
      contentHash: sig.content_hash ?? "",
      sentAt: bundle.deal.sent_at,
      viewedAt: sig.viewed_at ?? bundle.deal.viewed_at,
    },
  });
  const finalPath = `${bundle.deal.id}/final-v${sow.version}.pdf`;
  await uploadToStorage(finalPath, pdf);

  let driveId: string | null = null;
  if (googleConfigured() && bundle.deal.drive_folder_id) {
    try {
      driveId = await uploadPdf(pdf, `${client} - SOW v${sow.version} (final, countersigned).pdf`, bundle.deal.drive_folder_id);
    } catch (e) {
      console.error("[deal-docs] Drive upload of final PDF failed", e);
    }
  }

  await admin
    .from("deal_signatures")
    .update({
      fl_countersigned_by: auth.member.id,
      fl_countersigner_name: name,
      fl_countersigner_title: title,
      fl_countersigned_at: at,
      final_pdf_path: finalPath,
    })
    .eq("id", sig.id);
  await admin.from("deals").update({ status: "countersigned" }).eq("id", bundle.deal.id);
  await admin.from("project_links").insert({
    project_id: bundle.project.id,
    deal_id: bundle.deal.id,
    document_id: sow.id,
    kind: "final_pdf",
    label: `SOW v${sow.version} (final, countersigned)`,
    url: `${STORAGE_URL_PREFIX}${finalPath}`,
    drive_file_id: driveId,
    source: "system",
    created_by: auth.member.id,
  });
  if (bundle.deal.lead_id) {
    await admin.from("lead_touches").insert({
      lead_id: bundle.deal.lead_id,
      channel: "other",
      direction: "outbound",
      event: "deal_countersigned",
      summary: `Countersigned by ${name}`,
      touched_by: auth.member.id,
      details: { deal_id: bundle.deal.id, signer_name: name, sow_version: sow.version },
    });
  }
  await logDealEvent(db, bundle.deal.id, auth.member.id, "countersigned", { name, title, sow_version: sow.version });
  return NextResponse.json({ ok: true });
}
