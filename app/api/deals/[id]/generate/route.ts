import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { docsKeyConfigured } from "@/lib/deals/ai";
import { generateDocument } from "@/lib/deals/generate";
import { googleEnvProblems } from "@/lib/deals/google";
import { jsonError, loadDeal, requireMember } from "@/lib/deals/server";
import { logDealEvent } from "@/lib/deals/events";
import { refreshInternalDoc } from "@/lib/deals/internalDoc";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { kind: 'proposal' | 'sow', section?: string, restore_version?: number }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as {
    kind?: string;
    section?: string;
    restore_version?: number;
  };
  const kind = body.kind;
  if (kind !== "proposal" && kind !== "sow") return jsonError("kind must be proposal or sow");
  const envProblems = googleEnvProblems(kind);
  if (envProblems.length) return jsonError(`Google Docs setup: ${envProblems.join("; ")}`, 503);
  if (body.restore_version == null && !docsKeyConfigured()) return jsonError("Docs key not configured", 503);

  const db = createClient();
  const bundle = await loadDeal(db, params.id);
  if (!bundle) return jsonError("Deal not found", 404);
  if (bundle.deal.status === "signed" || bundle.deal.status === "countersigned" || bundle.deal.status === "void")
    return jsonError("This deal can no longer be changed");
  if (!bundle.items.length) return jsonError("Add line items first");

  const restoreFrom =
    body.restore_version != null
      ? bundle.docs.find((d) => d.kind === kind && d.version === body.restore_version)
      : undefined;
  if (body.restore_version != null && !restoreFrom) return jsonError("Version not found", 404);

  try {
    const doc = await generateDocument({ db, bundle, kind, section: body.section, restoreFrom });
    await logDealEvent(db, bundle.deal.id, auth.member.id, restoreFrom ? "restored" : "generated", {
      kind,
      version: doc.version,
      section: body.section ?? null,
      restored_from: body.restore_version ?? null,
    });
    // The internal deal doc follows every generate (never fails the request).
    const fresh = await loadDeal(db, bundle.deal.id);
    if (fresh) await refreshInternalDoc(db, fresh, auth.member.id, `generate ${kind}`);
    return NextResponse.json({ document: doc });
  } catch (e) {
    console.error("[deal-docs] generate failed", e);
    return jsonError(e instanceof Error ? e.message : "Generation failed", 500);
  }
}
