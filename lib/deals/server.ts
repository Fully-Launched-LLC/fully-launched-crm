import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTeamMember } from "@/lib/auth";
import type { Project, TeamMember } from "@/lib/types";
import {
  DEAL_DOCS_BUCKET,
  type Deal,
  type DealDocument,
  type DealLineItem,
  type DealSettings,
} from "@/lib/deals/types";

export const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Route guard: a signed-in team member (and optionally Admin/Manager/Admin).
export async function requireMember(
  level: "member" | "manager" | "admin" = "member"
): Promise<{ member: TeamMember } | { error: NextResponse }> {
  const member = await getCurrentTeamMember();
  if (!member) return { error: jsonError("Not signed in", 401) };
  if (level === "manager" && member.role !== "Admin" && member.role !== "Manager")
    return { error: jsonError("Only an Admin or Manager can do this", 403) };
  if (level === "admin" && member.role !== "Admin") return { error: jsonError("Only an Admin can do this", 403) };
  return { member };
}

export type DealBundle = {
  deal: Deal;
  items: DealLineItem[];
  project: Project;
  lead: {
    id: string;
    company: string | null;
    name: string;
    contact_name: string | null;
    category: string | null;
    city: string | null;
    website: string | null;
    notes: string | null;
  } | null;
  settings: DealSettings;
  docs: DealDocument[];
};

type Db = ReturnType<typeof createClient> | ReturnType<typeof createAdminClient>;

export async function loadDeal(db: Db, dealId: string): Promise<DealBundle | null> {
  const { data: deal } = await db.from("deals").select("*").eq("id", dealId).maybeSingle();
  if (!deal) return null;
  const [{ data: items }, { data: project }, { data: settings }, { data: docs }, leadRes] = await Promise.all([
    db.from("deal_line_items").select("*").eq("deal_id", dealId),
    db.from("projects").select("*").eq("id", deal.project_id).maybeSingle(),
    db.from("deal_settings").select("*").eq("id", true).maybeSingle(),
    db.from("deal_documents").select("*").eq("deal_id", dealId).order("version", { ascending: false }),
    deal.lead_id
      ? db
          .from("leads")
          .select("id, company, name, contact_name, category, city, website, notes")
          .eq("id", deal.lead_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!project || !settings) return null;
  return {
    deal: deal as Deal,
    items: ((items ?? []) as DealLineItem[]).map((i) => ({
      ...i,
      amount: Number(i.amount),
      overage_rate: i.overage_rate == null ? null : Number(i.overage_rate),
      hours_included: i.hours_included == null ? null : Number(i.hours_included),
    })),
    project: project as Project,
    lead: (leadRes.data as DealBundle["lead"]) ?? null,
    settings: settings as DealSettings,
    docs: (docs ?? []) as DealDocument[],
  };
}

// The client's name in documents and the Drive folder (Clients/{name}): the
// company record (lead) if the deal has one, else the project name. One value,
// trimmed, never combined. safeName() makes it folder-safe.
export function companyName(b: Pick<DealBundle, "lead" | "project">): string {
  const lead = b.lead?.company?.trim();
  if (lead) return lead;
  return b.project.client_name?.trim() || "Untitled client";
}

export function latestDoc(docs: DealDocument[], kind: DealDocument["kind"]): DealDocument | null {
  return docs.filter((d) => d.kind === kind).sort((a, b) => b.version - a.version)[0] ?? null;
}

// ---- Signing tokens ----------------------------------------------------------

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

// End of the valid_through day in America/Chicago, as a UTC instant.
export function endOfDayChicago(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  // Try both possible offsets (CST -6, CDT -5) and keep the one that lands on
  // 23:59:59 local.
  for (const offset of [5, 6]) {
    const utc = new Date(Date.UTC(y, m - 1, d, 23 + offset, 59, 59));
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "2-digit",
      hour12: false,
      day: "2-digit",
    }).formatToParts(utc);
    const hour = Number(local.find((p) => p.type === "hour")?.value);
    const day = Number(local.find((p) => p.type === "day")?.value);
    if (hour === 23 && day === d) return utc.toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d + 1, 5, 59, 59)).toISOString();
}

export function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://crm.fullylaunched.com";
}

// ---- Storage -----------------------------------------------------------------

export async function uploadToStorage(path: string, pdf: Uint8Array) {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(DEAL_DOCS_BUCKET)
    .upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

export async function downloadFromStorage(path: string): Promise<Uint8Array> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(DEAL_DOCS_BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "missing file"}`);
  return new Uint8Array(await data.arrayBuffer());
}

// Short-lived signed URL (default 5 minutes).
export async function signedUrl(path: string, seconds = 300, download?: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(DEAL_DOCS_BUCKET)
    .createSignedUrl(path, seconds, download ? { download } : undefined);
  if (error || !data) throw new Error(`Could not sign the file link: ${error?.message ?? ""}`);
  return data.signedUrl;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

// Per-IP rate limit on the public sign routes (deal_rate_hit, migration 036).
export async function rateLimited(req: Request, bucket: string, limit: number, windowSeconds = 60) {
  const admin = createAdminClient();
  const { data } = await admin.rpc("deal_rate_hit", {
    p_key: `${bucket}:${clientIp(req)}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  return data === false;
}
