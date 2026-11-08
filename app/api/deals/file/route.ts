import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireMember, signedUrl } from "@/lib/deals/server";

export const runtime = "nodejs";

// Team members open deal-docs files (frozen, signed, final PDFs) through a
// short-lived signed URL. ?path=<deal_id>/<file>.pdf; the deal must be one
// the caller can read (RLS).
export async function GET(req: Request) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const path = new URL(req.url).searchParams.get("path") ?? "";
  const m = path.match(/^([0-9a-f-]{36})\/[A-Za-z0-9._-]+\.pdf$/);
  if (!m) return jsonError("Bad path");
  const db = createClient();
  const { data: deal } = await db.from("deals").select("id").eq("id", m[1]).maybeSingle();
  if (!deal) return jsonError("Not found", 404);
  return NextResponse.redirect(await signedUrl(path, 120), 302);
}
