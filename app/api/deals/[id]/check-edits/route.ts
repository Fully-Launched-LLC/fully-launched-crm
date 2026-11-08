import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleConfigured } from "@/lib/deals/google";
import { detectDocEdits } from "@/lib/deals/approve";
import { jsonError, loadDeal, requireMember } from "@/lib/deals/server";

export const runtime = "nodejs";

// Called when the Deal Desk loads: if an approved Doc was edited in Google
// Docs after approval, the deal goes back to draft and unsigned links are
// revoked (the deals trigger does the cleanup).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  if (!googleConfigured()) return NextResponse.json({ edited: [] });
  const db = createClient();
  const bundle = await loadDeal(db, params.id);
  if (!bundle) return jsonError("Deal not found", 404);
  try {
    return NextResponse.json({ edited: await detectDocEdits(db, bundle) });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not check the Google Docs", 500);
  }
}
