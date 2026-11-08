import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createPlainDoc, docUrl, googleConfigured, safeName } from "@/lib/deals/google";
import { ensureDealFolder } from "@/lib/deals/generate";
import { computeInternal } from "@/lib/deals/internal";
import { internalDocBlocks } from "@/lib/deals/internalText";
import { logDealEvent } from "@/lib/deals/events";
import { companyName, jsonError, loadDeal, requireMember } from "@/lib/deals/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Selections } from "@/lib/deals/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Writes the internal deal doc (computed now) to Clients/{Company}/Internal
// as a plain Google Doc. The CRM page stays the source of truth.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  if (!googleConfigured()) return jsonError("Google Docs not configured", 503);
  const db = createClient();
  const bundle = await loadDeal(db, params.id);
  if (!bundle) return jsonError("Deal not found", 404);

  const { data: sig } = await createAdminClient()
    .from("deal_signatures")
    .select("selections")
    .eq("deal_id", bundle.deal.id)
    .not("signed_at", "is", null)
    .maybeSingle();
  const { data: members } = await db.from("team_members").select("id, name");
  const internal = computeInternal(bundle.deal, bundle.items, bundle.settings, (sig?.selections as Selections) ?? null);
  const folders = await ensureDealFolder(db, bundle);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${safeName(companyName(bundle))} - Internal Deal Doc ${stamp}`;
  const docId = await createPlainDoc(
    name,
    folders.internalId,
    internalDocBlocks(internal, companyName(bundle), (members ?? []) as { id: string; name: string }[])
  );
  await db.from("project_links").insert({
    project_id: bundle.project.id,
    deal_id: bundle.deal.id,
    kind: "internal_doc",
    label: name,
    url: docUrl(docId),
    drive_file_id: docId,
    source: "system",
  });
  await logDealEvent(db, bundle.deal.id, auth.member.id, "internal_exported", { google_doc_id: docId });
  return NextResponse.json({ url: docUrl(docId) });
}
