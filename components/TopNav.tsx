"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRANCH_SLUGS, branchLabel, type BranchSlug } from "@/lib/branches";
import NavClock from "@/components/clock/NavClock";
import UndoToast from "@/components/clock/UndoToast";
import ClockOutDialog from "@/components/clock/ClockOutDialog";
import { useTimeClock } from "@/components/clock/useTimeClock";
import { useDueFollowUps } from "@/components/sales/useDueFollowUps";

// Sales tab badge: my follow-ups due today or overdue; links to that list.
const DUE_HREF = "/sales?view=history&due=1";

// Nav-only labels; routes, branch values, and page headings are unchanged
// (e.g. /projects/ai still says "AI").
const SUB_TAB_LABELS: Partial<Record<BranchSlug, string>> = {
  ecommerce: "Ecomm",
  ai: "AI Integration",
};

const PROJECTS_HREF = "/projects/all";

export default function TopNav({
  isAdmin,
  memberId,
}: {
  isAdmin: boolean;
  // Signed-in user's team_members id; null if their login isn't on the
  // roster (no clock then).
  memberId: string | null;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const clock = useTimeClock(memberId);
  const due = useDueFollowUps(memberId, pathname);
  const dueBadge = due > 0 && (
    <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-header-foreground px-1.5 text-[11px] font-semibold leading-5 text-header">
      {due}
    </span>
  );

  // Branch list pages — these get the sub-tab row.
  const onProjects = pathname.startsWith("/projects/");
  // "Projects" stays highlighted on a single project's page too.
  const projectsActive = onProjects || pathname.startsWith("/project/");

  // Transactions is Admin-only (hidden here; its page redirects non-Admins,
  // and RLS is the real gate). Team is visible to everyone — non-Admins get a
  // read-only directory with booking links.
  const tabs = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Sales", href: "/sales" },
    { label: "Projects", href: PROJECTS_HREF },
    ...(isAdmin ? [{ label: "Transactions", href: "/transactions" }] : []),
    { label: "Contacts", href: "/contacts" },
    { label: "Team", href: "/team" },
  ];

  const subTabs = BRANCH_SLUGS.map((slug) => ({
    label: SUB_TAB_LABELS[slug] ?? branchLabel(slug),
    href: `/projects/${slug}`,
  }));

  // Top-level tabs. "Projects" covers every /projects/* branch page and
  // /project/[id].
  function isActive(href: string) {
    if (href === PROJECTS_HREF) return projectsActive;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // Sub-tabs match exactly — "All" shares /projects/all with the Projects
  // tab, so isActive() would light it up on every branch page.
  function isSubActive(href: string) {
    return pathname === href;
  }

  const activeSub = subTabs.find((t) => isSubActive(t.href));
  // No tab is active on e.g. /project/[id]; the mobile bar falls back to "Menu".
  const activeLabel = activeSub
    ? `Projects · ${activeSub.label}`
    : tabs.find((t) => isActive(t.href))?.label ?? "Menu";

  // Close the mobile menu after navigating (incl. back/forward), and on
  // Escape. Links also close it on tap, which covers tapping the current tab.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // The mobile Projects group starts expanded when you're on a Projects page.
  useEffect(() => {
    if (menuOpen) setProjectsExpanded(onProjects);
  }, [menuOpen, onProjects]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Active indicators on the dark header are white (header-foreground): the
  // navy accent is nearly invisible on it. The light sub-tab row keeps navy.
  const mobileLinkClass = (active: boolean) =>
    `block border-l-4 py-3 text-sm font-medium text-header-foreground ${
      active ? "border-header-foreground opacity-100" : "border-transparent opacity-70"
    }`;

  return (
    <nav className="relative z-30 bg-header">
      {/* Desktop (sm and up): top-level tabs, wrapping if they run out of room. */}
      <div className="mx-auto hidden max-w-6xl flex-wrap items-center gap-1 px-4 sm:flex">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href === "/sales" && due > 0 ? DUE_HREF : tab.href}
            title={tab.href === "/sales" && due > 0 ? `${due} follow-up${due === 1 ? "" : "s"} due` : undefined}
            className={`border-b-2 px-4 py-3 text-sm font-medium text-header-foreground transition-opacity ${
              isActive(tab.href)
                ? "border-header-foreground opacity-100"
                : "border-transparent opacity-70 hover:opacity-100"
            }`}
          >
            {tab.label}
            {tab.href === "/sales" && dueBadge}
          </Link>
        ))}
        {memberId && (
          <div className="ml-auto py-2">
            <NavClock clock={clock} />
          </div>
        )}
      </div>

      {/* Desktop Projects sub-tabs: a lighter second row, only on /projects/*. */}
      {onProjects && (
        <div className="hidden border-b border-neutral-200 bg-neutral-100 sm:block">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4">
            {subTabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  isSubActive(tab.href)
                    ? "border-accent text-foreground"
                    : "border-transparent text-neutral-500 hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Mobile (below sm): current tab + hamburger that opens a dropdown
          list over the page content. */}
      <div className="relative z-10 flex items-center justify-between bg-header px-4 sm:hidden">
        <span className="py-3 text-sm font-medium text-header-foreground">
          {activeLabel}
        </span>
        <div className="flex items-center gap-2">
          {memberId && <NavClock clock={clock} />}
          <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-header-foreground"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            {menuOpen ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          {/* Tap-outside-to-close backdrop: over the page, under the bar and
              menu (both z-10 within the nav). */}
          <div
            className="fixed inset-0 bg-black/30 sm:hidden"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div
            id="mobile-nav-menu"
            className="absolute inset-x-0 top-full z-10 border-t border-white/10 bg-header pb-2 shadow-lg sm:hidden"
          >
            {tabs.map((tab) =>
              tab.href === PROJECTS_HREF ? (
                <div key={tab.href}>
                  {/* Label goes to All; the chevron expands the sub-tabs. */}
                  <div className="flex items-center">
                    <Link
                      href={tab.href}
                      onClick={() => setMenuOpen(false)}
                      className={`flex-1 px-4 ${mobileLinkClass(isActive(tab.href))}`}
                    >
                      {tab.label}
                    </Link>
                    <button
                      type="button"
                      onClick={() => setProjectsExpanded((v) => !v)}
                      aria-expanded={projectsExpanded}
                      aria-controls="mobile-nav-projects"
                      aria-label={
                        projectsExpanded ? "Collapse Projects" : "Expand Projects"
                      }
                      className="mr-2 flex h-11 w-11 items-center justify-center text-header-foreground opacity-70"
                    >
                      <svg
                        aria-hidden
                        viewBox="0 0 24 24"
                        className={`h-5 w-5 transition-transform ${
                          projectsExpanded ? "rotate-180" : ""
                        }`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                  {projectsExpanded && (
                    <div id="mobile-nav-projects">
                      {subTabs.map((sub) => (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          onClick={() => setMenuOpen(false)}
                          className={`pl-10 pr-4 ${mobileLinkClass(isSubActive(sub.href))}`}
                        >
                          {sub.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  key={tab.href}
                  href={tab.href === "/sales" && due > 0 ? DUE_HREF : tab.href}
                  onClick={() => setMenuOpen(false)}
                  className={`px-4 ${mobileLinkClass(isActive(tab.href))}`}
                >
                  {tab.label}
                  {tab.href === "/sales" && dueBadge}
                </Link>
              )
            )}
          </div>
        </>
      )}
      <UndoToast clock={clock} />
      <ClockOutDialog clock={clock} />
    </nav>
  );
}
