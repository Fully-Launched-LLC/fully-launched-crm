import Link from "next/link";
import type { Lead } from "@/lib/types";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export default function RecentLeadsCard({ leads }: { leads: Lead[] }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Recently Added Leads
        </h2>
        <Link
          href="/leads?view=history"
          className="text-xs font-medium text-neutral-500 hover:text-foreground hover:underline"
        >
          View all
        </Link>
      </div>

      {leads.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">No leads yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {leads.map((lead) => (
            <li key={lead.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {lead.name}
                </p>
                {lead.source && (
                  <p className="text-xs text-neutral-500">{lead.source}</p>
                )}
              </div>
              <span className="shrink-0 whitespace-nowrap text-neutral-500">
                {dateFormat.format(new Date(lead.created_at))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
