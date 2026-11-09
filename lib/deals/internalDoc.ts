import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { docUrl, safeName, writePlainDoc } from "@/lib/deals/google";
import { computeInternal } from "@/lib/deals/internal";
import { internalDocBlocks } from "@/lib/deals/internalText";
import { logDealEvent } from "@/lib/deals/events";
import { ensureDealFolder } from "@/lib/deals/generate";
import { companyName, type DealBundle } from "@/lib/deals/server";
import type { Selections } from "@/lib/deals/types";

type Db = ReturnType<typeof createClient>;

// The internal deal doc as a Google Doc in Clients/{Company}/Internal: one
// per deal, rewritten in place (same link) on every Proposal / SOW generate,
// at approval, and from Export on the internal page. Computed in code; the
// CRM page stays the source of truth.
export async function writeInternalDoc(db: Db, b: DealBundle, actorId: string | null, cause: string) {
  const { data: sig } = await createAdminClient()
    .from("deal_signatures")
    .select("selections")
    .eq("deal_id", b.deal.id)
    .not("signed_at", "is", null)
    .maybeSingle();
  const { data: members } = await db.from("team_members").select("id, name");
  const internal = computeInternal(b.deal, b.items, b.settings, (sig?.selections as Selections) ?? null);
  const folders = await ensureDealFolder(db, b);

  const { data: existing } = await db
    .from("project_links")
    .select("id, drive_file_id")
    .eq("deal_id", b.deal.id)
    .eq("kind", "internal_doc")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const name = `${safeName(companyName(b))} - Internal Deal Doc`;
  const docId = await writePlainDoc(
    name,
    folders.internalId,
    internalDocBlocks(internal, companyName(b), (members ?? []) as { id: string; name: string }[]),
    existing?.drive_file_id
  );
  if (!existing || existing.drive_file_id !== docId) {
    await db.from("project_links").insert({
      project_id: b.project.id,
      deal_id: b.deal.id,
      kind: "internal_doc",
      label: name,
      url: docUrl(docId),
      drive_file_id: docId,
      source: "system",
    });
  }
  if (actorId) await logDealEvent(db, b.deal.id, actorId, "internal_doc_written", { google_doc_id: docId, cause });
  return { docId, url: docUrl(docId) };
}

// Same, but never fails the caller (generate / approve): logs and returns null.
export async function refreshInternalDoc(db: Db, b: DealBundle, actorId: string | null, cause: string) {
  try {
    return await writeInternalDoc(db, b, actorId, cause);
  } catch (e) {
    console.error("[deal-docs] internal doc not written", cause, e);
    return null;
  }
}
