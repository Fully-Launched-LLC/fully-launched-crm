import { createClient } from "@/lib/supabase/server";
import { errorResponse, requireMember } from "@/lib/lead-finder/http";
import { HttpError } from "@/lib/lead-finder/runner";
import { ApolloConfigError, apolloReveal, apolloSearch } from "@/lib/sales/apollo";

// POST /api/sales/apollo  ("Find owner contact", side preview + dossier)
//   { action: "search", website, placeId, leadId?, businessName }
//       -> { people, credits, domain }
//   { action: "reveal", personId, personName, placeId, leadId?, businessName }
//       -> { person, credits }   (one Apollo credit)
// Only ever called by a button click. Every call is logged to
// enrichment_lookups (migration 026) as the signed-in user, errors included.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = {
  action?: string;
  website?: string;
  placeId?: string;
  leadId?: string | null;
  businessName?: string;
  personId?: string;
  personName?: string;
};

function domainOf(website: string | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : "https://" + website).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    await requireMember();
    const body = (await request.json()) as Body;
    const supabase = createClient();
    const log = (row: Record<string, unknown>) =>
      supabase.from("enrichment_lookups").insert({
        provider: "apollo",
        lead_id: body.leadId || null,
        place_id: body.placeId || null,
        business_name: body.businessName || null,
        ...row,
      });

    if (body.action === "search") {
      const domain = domainOf(body.website);
      if (!domain) throw new HttpError(400, "This business has no website domain to look up.");
      try {
        const { people, credits } = await apolloSearch(domain);
        await log({ kind: "search", domain, results_count: people.length, credits_remaining: credits });
        return Response.json({ people, credits, domain });
      } catch (e) {
        if (!(e instanceof ApolloConfigError)) await log({ kind: "search", domain, error: (e as Error).message });
        throw e;
      }
    }

    if (body.action === "reveal") {
      if (!body.personId) throw new HttpError(400, "Missing person.");
      try {
        const { person, credits } = await apolloReveal(body.personId);
        await log({ kind: "reveal", person: body.personName || null, results_count: person?.email ? 1 : 0, credits_remaining: credits });
        return Response.json({ person, credits });
      } catch (e) {
        if (!(e instanceof ApolloConfigError)) await log({ kind: "reveal", person: body.personName || null, error: (e as Error).message });
        throw e;
      }
    }
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    if (e instanceof ApolloConfigError) return Response.json({ error: e.message }, { status: 500 });
    return errorResponse(e);
  }
}
