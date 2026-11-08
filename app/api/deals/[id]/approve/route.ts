import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleConfigured } from "@/lib/deals/google";
import { approveDeal } from "@/lib/deals/approve";
import { jsonError, loadDeal, requireMember } from "@/lib/deals/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// Admin/Manager only (also enforced by the deals / deal_documents triggers).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireMember("manager");
  if ("error" in auth) return auth.error;
  if (!googleConfigured()) return jsonError("Google Docs not configured", 503);

  const db = createClient();
  const bundle = await loadDeal(db, params.id);
  if (!bundle) return jsonError("Deal not found", 404);
  if (bundle.deal.status !== "draft") return jsonError(`This deal is ${bundle.deal.status}, not a draft`);

  try {
    const result = await approveDeal(db, bundle, auth.member.id);
    if ("blockers" in result) return NextResponse.json({ blockers: result.blockers }, { status: 422 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[deal-docs] approve failed", e);
    return jsonError(`${e instanceof Error ? e.message : "Approval failed"}. The deal is back to draft.`, 500);
  }
}
