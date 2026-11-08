import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleConfigured } from "@/lib/deals/google";
import { detectDocEdits } from "@/lib/deals/approve";
import { logDealEvent } from "@/lib/deals/events";
import {
  appOrigin,
  endOfDayChicago,
  jsonError,
  latestDoc,
  loadDeal,
  newToken,
  requireMember,
} from "@/lib/deals/server";

export const runtime = "nodejs";

// POST { regenerate?: boolean } -> { link } (shown once). Only the sha256 of
// the token is stored. Regenerate revokes the old unsigned link.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { regenerate?: boolean };

  const db = createClient();
  const bundle = await loadDeal(db, params.id);
  if (!bundle) return jsonError("Deal not found", 404);
  const { deal } = bundle;
  if (!["approved", "sent", "viewed"].includes(deal.status)) return jsonError("Approve the deal before sending it");

  if (googleConfigured()) {
    const edited = await detectDocEdits(db, bundle);
    if (edited.length)
      return jsonError(
        `Edited in Google Docs after approval (${edited.join(", ")}). The deal is back to draft: approve it again to send.`,
        409
      );
  }

  const sow = latestDoc(bundle.docs, "sow");
  const proposal = latestDoc(bundle.docs, "proposal");
  if (!sow?.frozen_pdf_path || !proposal?.frozen_pdf_path) return jsonError("The approved PDFs are missing. Approve again.");

  // Status first: the deals trigger refuses an expired deal (valid_through
  // before today, America/Chicago), for a first send and a regenerate alike.
  const { error: sendErr } = await db
    .from("deals")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", deal.id);
  if (sendErr) return jsonError(sendErr.message);

  const admin = createAdminClient();
  await admin
    .from("deal_signatures")
    .update({ revoked_at: new Date().toISOString() })
    .eq("deal_id", deal.id)
    .is("signed_at", null)
    .is("revoked_at", null);

  const { token, hash } = newToken();
  const { error } = await admin.from("deal_signatures").insert({
    deal_id: deal.id,
    document_id: sow.id,
    proposal_document_id: proposal.id,
    token_hash: hash,
    expires_at: endOfDayChicago(deal.valid_through!),
    created_by: auth.member.id,
  });
  if (error) return jsonError(error.message, 500);

  await logDealEvent(db, deal.id, auth.member.id, body.regenerate ? "link_regenerated" : "sent", {
    sow_version: sow.version,
    proposal_version: proposal.version,
    expires: deal.valid_through,
  });
  return NextResponse.json({ link: `${appOrigin()}/sign/${token}` });
}
