import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateSelections } from "@/lib/deals/money";
import { buildSignaturePackage } from "@/lib/deals/pdf";
import { googleConfigured, uploadPdf } from "@/lib/deals/google";
import { onDealSigned } from "@/lib/deals/on-deal-signed";
import { resolveToken, signedContentHash } from "@/lib/deals/signing";
import {
  clientIp,
  downloadFromStorage,
  jsonError,
  rateLimited,
  sha256,
  signedUrl,
  uploadToStorage,
} from "@/lib/deals/server";
import { CONSENT_TEXT, STORAGE_URL_PREFIX } from "@/lib/deals/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const STAGES_BEFORE_SIGNED = ["Interested", "Negotiation"];

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (await rateLimited(req, "sign-post", 10)) return jsonError("Too many attempts. Wait a minute and try again.", 429);

  const t = await resolveToken(params.token);
  if (t.state !== "open")
    return jsonError(
      t.state === "signed" ? "This agreement is already signed." : "This signing link is no longer valid.",
      410
    );

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    title?: string;
    email?: string;
    signature?: string;
    consent?: boolean;
    selections?: string[];
  } | null;
  const name = body?.name?.trim() ?? "";
  const title = body?.title?.trim() ?? "";
  const email = body?.email?.trim() ?? "";
  const typed = body?.signature?.trim() ?? "";
  if (!name || !title || !typed) return jsonError("Fill in your name, title and signature.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Enter a valid email address.");
  if (body?.consent !== true) return jsonError("Check the consent box to sign.");
  const selections = { items: Array.isArray(body?.selections) ? body!.selections!.map(String) : [] };
  const selErr = validateSelections(t.items, selections);
  if (selErr) return jsonError(selErr);

  const admin = createAdminClient();
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent") ?? "unknown";
  const signedAt = new Date().toISOString();

  // The frozen PDFs must be exactly what was approved.
  const [proposalPdf, sowPdf] = await Promise.all([
    downloadFromStorage(t.proposal.frozen_pdf_path!),
    downloadFromStorage(t.sow.frozen_pdf_path!),
  ]);
  if (sha256(sowPdf) !== t.sow.content_hash || sha256(proposalPdf) !== t.proposal.content_hash) {
    console.error("[deal-docs] frozen PDF hash mismatch", t.deal.id);
    return jsonError("This agreement could not be verified. Please contact Fully Launched.", 409);
  }
  const contentHash = signedContentHash(t.sow.content_hash!, selections.items);

  // Claim the link first so a double submit can't sign twice.
  const { data: claimed } = await admin
    .from("deal_signatures")
    .update({
      signer_name: name,
      signer_title: title,
      signer_email: email,
      typed_signature: typed,
      consent: true,
      consent_text: CONSENT_TEXT,
      selections,
      content_hash: contentHash,
      signed_at: signedAt,
      ip,
      user_agent: userAgent,
    })
    .eq("id", t.signature.id)
    .is("signed_at", null)
    .is("revoked_at", null)
    .select("id");
  if (!claimed?.length) return jsonError("This agreement is already signed.", 409);

  let pdf: Uint8Array;
  const pdfPath = `${t.deal.id}/signed-v${t.sow.version}.pdf`;
  try {
    pdf = await buildSignaturePackage({
      proposalPdf,
      sowPdf,
      items: t.items,
      selections,
      signer: { name, title, email, typed, signedAt, ip, userAgent, consentText: CONSENT_TEXT },
      countersign: null,
      audit: {
        dealId: t.deal.id,
        clientName: t.clientName,
        proposal: { version: t.proposal.version, hash: t.proposal.content_hash },
        sow: { version: t.sow.version, hash: t.sow.content_hash },
        contentHash,
        sentAt: t.deal.sent_at,
        viewedAt: t.signature.viewed_at ?? t.deal.viewed_at,
      },
    });
    await uploadToStorage(pdfPath, pdf);
    await admin.from("deal_signatures").update({ pdf_path: pdfPath }).eq("id", t.signature.id);
  } catch (e) {
    // Give the link back so the client can try again.
    console.error("[deal-docs] building the signed PDF failed", e);
    await admin
      .from("deal_signatures")
      .update({
        signer_name: null, signer_title: null, signer_email: null, typed_signature: null, consent: null,
        consent_text: null, selections: null, content_hash: null, signed_at: null, ip: null, user_agent: null,
      })
      .eq("id", t.signature.id);
    return jsonError("Something went wrong while preparing your signed copy. Please try again.", 500);
  }

  let driveId: string | null = null;
  if (googleConfigured() && t.deal.drive_folder_id) {
    try {
      driveId = await uploadPdf(pdf, `${t.clientName} - SOW v${t.sow.version} (signed).pdf`, t.deal.drive_folder_id);
    } catch (e) {
      console.error("[deal-docs] Drive upload of signed PDF failed", e);
    }
  }

  await admin.from("deals").update({ status: "signed", signed_at: signedAt }).eq("id", t.deal.id);

  // Project -> Signed (the same update the stage picker makes).
  const { data: project } = await admin.from("projects").select("id, stage").eq("id", t.deal.project_id).maybeSingle();
  if (project && STAGES_BEFORE_SIGNED.includes(project.stage)) {
    await admin.from("projects").update({ stage: "Signed" }).eq("id", project.id);
  }

  await admin.from("project_links").insert({
    project_id: t.deal.project_id,
    deal_id: t.deal.id,
    document_id: t.sow.id,
    kind: "signed_pdf",
    label: `SOW v${t.sow.version} (signed by ${name})`,
    url: `${STORAGE_URL_PREFIX}${pdfPath}`,
    drive_file_id: driveId,
    source: "system",
  });
  await admin.from("deal_events").insert({
    deal_id: t.deal.id,
    kind: "signed",
    actor: null,
    details: { signer_name: name, signer_title: title, signer_email: email, sow_version: t.sow.version, ip },
  });
  if (t.deal.lead_id) {
    await admin.from("lead_touches").insert({
      lead_id: t.deal.lead_id,
      channel: "other",
      direction: "inbound",
      event: "deal_signed",
      summary: `${name} signed the Statement of Work`,
      touched_by: null,
      details: { deal_id: t.deal.id, signer_name: name, sow_version: t.sow.version },
    });
    await admin.from("leads").update({ status: "converted" }).eq("id", t.deal.lead_id);
  }

  try {
    await onDealSigned(t.deal.id);
  } catch (e) {
    console.error("[deal-docs] onDealSigned failed", e);
  }

  return NextResponse.json({ ok: true, download: await signedUrl(pdfPath, 600, `signed-v${t.sow.version}.pdf`) });
}
