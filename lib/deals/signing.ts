import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/deals/server";
import type { Deal, DealDocument, DealLineItem, DealSignature } from "@/lib/deals/types";

export type TokenState =
  | { state: "invalid" }
  | { state: "revoked"; clientName: string }
  | { state: "expired"; clientName: string }
  | { state: "signed"; clientName: string; signature: DealSignature }
  | {
      state: "open";
      clientName: string;
      signature: DealSignature;
      deal: Deal;
      items: DealLineItem[];
      proposal: DealDocument;
      sow: DealDocument;
    };

// Public sign flow: everything by token, with the service role. The token
// itself is never stored, only its sha256.
export async function resolveToken(token: string): Promise<TokenState> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return { state: "invalid" };
  const admin = createAdminClient();
  const { data: sig } = await admin
    .from("deal_signatures")
    .select("*")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!sig) return { state: "invalid" };
  const signature = sig as DealSignature;

  const { data: deal } = await admin.from("deals").select("*").eq("id", signature.deal_id).maybeSingle();
  if (!deal) return { state: "invalid" };
  const { data: project } = await admin.from("projects").select("client_name").eq("id", deal.project_id).maybeSingle();
  const { data: lead } = deal.lead_id
    ? await admin.from("leads").select("company").eq("id", deal.lead_id).maybeSingle()
    : { data: null };
  const clientName = (lead?.company as string | null)?.trim() || (project?.client_name as string) || "Client";

  if (signature.signed_at) return { state: "signed", clientName, signature };
  if (signature.revoked_at || deal.status === "void" || deal.status === "draft") return { state: "revoked", clientName };
  if (new Date(signature.expires_at) < new Date()) return { state: "expired", clientName };

  const [{ data: items }, { data: docs }] = await Promise.all([
    admin.from("deal_line_items").select("*").eq("deal_id", deal.id),
    admin
      .from("deal_documents")
      .select("*")
      .in("id", [signature.document_id, signature.proposal_document_id].filter(Boolean) as string[]),
  ]);
  const sow = (docs ?? []).find((d) => d.id === signature.document_id) as DealDocument | undefined;
  const proposal = (docs ?? []).find((d) => d.id === signature.proposal_document_id) as DealDocument | undefined;
  if (!sow?.frozen_pdf_path || !proposal?.frozen_pdf_path) return { state: "revoked", clientName };

  return {
    state: "open",
    clientName,
    signature,
    deal: deal as Deal,
    items: ((items ?? []) as DealLineItem[]).map((i) => ({
      ...i,
      amount: Number(i.amount),
      overage_rate: i.overage_rate == null ? null : Number(i.overage_rate),
      hours_included: i.hours_included == null ? null : Number(i.hours_included),
    })),
    proposal,
    sow,
  };
}

// First view: viewed_at on the link and the deal, status sent -> viewed,
// activity logged.
export async function markViewed(t: Extract<TokenState, { state: "open" }>) {
  if (t.signature.viewed_at) return;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: updated } = await admin
    .from("deal_signatures")
    .update({ viewed_at: now })
    .eq("id", t.signature.id)
    .is("viewed_at", null)
    .select("id");
  if (!updated?.length) return;
  await admin
    .from("deals")
    .update({ viewed_at: t.deal.viewed_at ?? now, ...(t.deal.status === "sent" ? { status: "viewed" } : {}) })
    .eq("id", t.deal.id);
  await admin.from("deal_events").insert({ deal_id: t.deal.id, kind: "viewed", actor: null, details: { signature_id: t.signature.id } });
}

// What the signer agreed to: the frozen SOW PDF's hash plus the selections.
export function signedContentHash(sowPdfHash: string, selected: string[]): string {
  return sha256(JSON.stringify({ sow_pdf_sha256: sowPdfHash, selected_items: [...selected].sort() }));
}
