import type { Lead } from "@/lib/types";

// Columns the Leads list loads. audit and scan_tags (big JSON) are left out
// and fetched by the drawer for one lead; audit_at tells the list whether a
// saved audit exists.
export const LEAD_LIST_COLUMNS =
  "id, name, company, contact_name, title, email, phone, website, domain, address, city, state, " +
  "industry, category, branch_fit, wheaton_alum, source, source_detail, external_ids, google_place_id, " +
  "maps_url, rating, review_count, website_status, lead_score, priority_score, uses_servicetitan, " +
  "audit_at, notes, status, found_by, owner, project_id, last_touch_at, next_action, next_action_at, " +
  "contact_linkedin, company_linkedin, owner_email, owner_phone, owner_since, created_at, updated_at";

export type LeadListRow = Omit<Lead, "audit" | "scan_tags" | "contact_info" | "phone_digits">;

// Owned by someone else (and I'm not Admin/Manager): read-only in Leads.
export function ownedByOther(lead: { owner: string | null } | null, me: { id: string; role: string } | null): boolean {
  return !!lead?.owner && !!me && lead.owner !== me.id && me.role !== "Admin" && me.role !== "Manager";
}

// RLS on leads (migration 017): Admin/Manager change any lead; everyone else
// only leads they own or that have no owner.
export function canEditLead(lead: { owner: string | null }, me: { id: string; role: string } | null): boolean {
  if (!me) return false;
  return me.role === "Admin" || me.role === "Manager" || !lead.owner || lead.owner === me.id;
}

export const RLS_HINT = "Only the owner or an Admin/Manager can change a lead someone else owns.";
