import type { ExistingLead, ScannedPlace } from "@/lib/lead-finder/types";
import { plausibleOwnerName } from "@/lib/lead-finder/ownerName";

// The person at the business (leads.contact_name / title / email / phone),
// as Sales shows it. Not the CRM user working it: that's leads.owner,
// labelled "Assigned to".
//
// A name a person typed (title set and not the scanner's "Possible owner")
// is shown as is; a scan guess only if it passes the owner-name check, so
// older guesses like "throughout the" read as unknown.
export const SCAN_TITLE = "Possible owner";

export function ownerNameOf(place: ScannedPlace, existing: ExistingLead | null): string | null {
  if (existing?.title && existing.title !== SCAN_TITLE) return existing.contact_name;
  const guess = existing ? existing.contact_name ?? place.ownerName : place.ownerName;
  return plausibleOwnerName(guess) ? guess : null;
}

// "Business owner" for owners (and scan guesses), "Contact" for anyone else.
export function contactLabel(title: string | null | undefined): string {
  return !title || title === SCAN_TITLE || /owner|founder|president|proprietor|ceo|principal/i.test(title)
    ? "Business owner"
    : "Contact";
}

export function contactEmail(place: ScannedPlace, existing: ExistingLead | null): string | null {
  return existing?.email ?? place.emails[0] ?? null;
}

export function contactPhone(place: ScannedPlace, existing: ExistingLead | null): string | null {
  const p = existing?.phone ?? place.phone;
  return p && p !== "No phone listed" ? p : null;
}
