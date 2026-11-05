import type { ExistingLead, ScannedPlace } from "@/lib/lead-finder/types";
import { plausibleOwnerName } from "@/lib/lead-finder/ownerName";

// The owner name Sales shows. A name a person typed (record title "Owner")
// is shown as is; a scan guess only if it passes the owner-name check, so
// older guesses like "throughout the" read as unknown.
export function ownerNameOf(place: ScannedPlace, existing: ExistingLead | null): string | null {
  if (existing?.title === "Owner") return existing.contact_name;
  const guess = existing ? existing.contact_name ?? place.ownerName : place.ownerName;
  return plausibleOwnerName(guess) ? guess : null;
}
