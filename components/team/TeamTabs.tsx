"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "People", href: "/team" },
  { label: "Timesheets", href: "/team/timesheets" },
];

// In-page tabs for the Team section (the top nav keeps a single Team tab).
export default function TeamTabs() {
  const pathname = usePathname();
  return (
    <div className="mt-4 flex gap-1 border-b border-neutral-200">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            pathname === tab.href
              ? "border-accent text-foreground"
              : "border-transparent text-neutral-500 hover:text-foreground"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
