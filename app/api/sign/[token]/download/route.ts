import { NextResponse } from "next/server";
import { resolveToken } from "@/lib/deals/signing";
import { jsonError, rateLimited, signedUrl } from "@/lib/deals/server";

export const runtime = "nodejs";

// The signer's own copy: final (countersigned) PDF if there is one, else the
// signed PDF. Redirects to a short-lived signed URL.
export async function GET(req: Request, { params }: { params: { token: string } }) {
  if (await rateLimited(req, "sign-download", 20)) return jsonError("Too many requests. Try again in a minute.", 429);
  const t = await resolveToken(params.token);
  if (t.state !== "signed") return jsonError("No signed copy for this link.", 404);
  const path = t.signature.final_pdf_path ?? t.signature.pdf_path;
  if (!path) return jsonError("The signed copy is still being prepared. Try again shortly.", 404);
  const name = path.split("/").pop() ?? "agreement.pdf";
  return NextResponse.redirect(await signedUrl(path, 120, name), 302);
}
