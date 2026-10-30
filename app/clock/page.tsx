import type { Metadata } from "next";
import { getCurrentTeamMember } from "@/lib/auth";
import ClockPanel from "@/components/clock/ClockPanel";

export const metadata: Metadata = { title: "FL Clock" };

// Standalone clock, outside the (app) layout so it has no nav: this is the
// installed PWA's start_url (public/manifest.json). Login is still required
// (middleware).
export default async function ClockPage() {
  const teamMember = await getCurrentTeamMember();

  if (!teamMember) {
    return (
      <p className="p-4 text-sm text-neutral-600">
        Your login isn&apos;t on the team roster, so there&apos;s no clock for it.
        Ask an Admin to add you on the Team page.
      </p>
    );
  }

  return <ClockPanel memberId={teamMember.id} memberName={teamMember.name} />;
}
