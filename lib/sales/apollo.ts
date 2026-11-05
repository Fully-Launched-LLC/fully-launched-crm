import "server-only";

// Apollo.io ("Find owner contact", on demand only). Server-only key:
// APOLLO_API_KEY (never NEXT_PUBLIC_). Two calls:
//   search  POST /api/v1/mixed_people/search: people at the business's
//           domain with owner-type titles. Emails come back only if your
//           Apollo account already unlocked them.
//   reveal  POST /api/v1/people/match {id}: one person's work email (uses
//           an Apollo credit).
// Field names follow Apollo's API docs; check them against the first live
// lookup. Credits remaining are shown only if Apollo sends them back.

export class ApolloConfigError extends Error {}

const BASE = "https://api.apollo.io/api/v1";
export const OWNER_TITLES = ["Owner", "Founder", "President", "CEO", "General Manager"];

export type ApolloPerson = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
};

type RawPerson = {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string | null;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  phone_numbers?: { sanitized_number?: string; raw_number?: string }[] | null;
  sanitized_phone?: string | null;
};

function key(): string {
  const k = process.env.APOLLO_API_KEY;
  if (!k) throw new ApolloConfigError("APOLLO_API_KEY is not set on the server.");
  return k;
}

// Apollo shows locked emails as placeholders (email_not_unlocked@domain.com).
function realEmail(e: string | null | undefined): string | null {
  if (!e || /not_unlocked|@domain\.com$/i.test(e)) return null;
  return e.trim();
}

function toPerson(p: RawPerson): ApolloPerson | null {
  if (!p.id) return null;
  const name = (p.name || [p.first_name, p.last_name].filter(Boolean).join(" ")).trim();
  if (!name) return null;
  return {
    id: p.id,
    name,
    title: p.title?.trim() || null,
    email: realEmail(p.email),
    phone: p.phone_numbers?.[0]?.sanitized_number || p.phone_numbers?.[0]?.raw_number || p.sanitized_phone || null,
    linkedin: p.linkedin_url || null,
  };
}

// Credits left, if Apollo reports them (body or headers); else null.
function creditsFrom(res: Response, json: Record<string, unknown>): number | null {
  for (const k of ["credits_remaining", "remaining_credits", "email_credits_remaining"]) {
    const v = json[k];
    if (typeof v === "number") return v;
  }
  for (const [h, v] of Array.from(res.headers.entries())) {
    if (/credit/i.test(h) && /remaining|left/i.test(h) && /^\d+$/.test(v.trim())) return Number(v);
  }
  return null;
}

async function call(path: string, body: Record<string, unknown>) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error as string) || (json.message as string) || `Apollo returned ${res.status}.`;
    throw new Error(msg);
  }
  return { json, credits: creditsFrom(res, json) };
}

export async function apolloSearch(domain: string): Promise<{ people: ApolloPerson[]; credits: number | null }> {
  const { json, credits } = await call("/mixed_people/search", {
    q_organization_domains_list: [domain],
    person_titles: OWNER_TITLES,
    page: 1,
    per_page: 10,
  });
  const raw = ((json.people as RawPerson[]) ?? []).concat((json.contacts as RawPerson[]) ?? []);
  const people = raw.map(toPerson).filter((p): p is ApolloPerson => !!p);
  return { people: people.filter((p, i) => people.findIndex((q) => q.id === p.id) === i), credits };
}

export async function apolloReveal(id: string): Promise<{ person: ApolloPerson | null; credits: number | null }> {
  const { json, credits } = await call("/people/match", { id, reveal_personal_emails: false });
  return { person: json.person ? toPerson(json.person as RawPerson) : null, credits };
}
