import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleEnvProblems } from "@/lib/deals/google";
import { writeInternalDoc } from "@/lib/deals/internalDoc";
import { jsonError, loadDeal, requireMember } from "@/lib/deals/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Rewrites the internal deal doc (computed now) in Clients/{Company}/Internal.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const envProblems = googleEnvProblems();
  if (envProblems.length) return jsonError(`Google Docs setup: ${envProblems.join("; ")}`, 503);
  const db = createClient();
  const bundle = await loadDeal(db, params.id);
  if (!bundle) return jsonError("Deal not found", 404);
  try {
    const { url } = await writeInternalDoc(db, bundle, auth.member.id, "export");
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[deal-docs] internal export failed", e);
    return jsonError(e instanceof Error ? e.message : "Export failed", 500);
  }
}
