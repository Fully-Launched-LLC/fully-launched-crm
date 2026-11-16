"use client";

import { useMemo, useRef, useState } from "react";
import Popover from "@/components/table/Popover";
import type { TeamMember } from "@/lib/types";
import { memberColors, pickableMembers } from "@/lib/team";
import { UNKNOWN_MEMBER_COLOR } from "@/lib/theme";

export default function MultiSelectCell({
  teamMembers,
  selectedIds,
  onCommit,
}: {
  teamMembers: TeamMember[];
  selectedIds: string[];
  onCommit: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const colors = useMemo(() => memberColors(teamMembers), [teamMembers]);
  const selected = teamMembers.filter((m) => selectedIds.includes(m.id));
  // Archived members show while selected (history) but can't be newly picked.
  const options = pickableMembers(teamMembers, selectedIds);

  function toggle(id: string) {
    onCommit(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );
  }

  return (
    <div ref={ref} className="min-w-[9rem]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[1.75rem] w-full flex-wrap items-center gap-1 rounded px-1.5 py-1 text-left hover:bg-neutral-50"
      >
        {selected.length === 0 ? (
          <span className="text-neutral-400">—</span>
        ) : (
          selected.map((m) => (
            <span
              key={m.id}
              className={`rounded-full px-2 py-0.5 text-xs ${
                colors.get(m.id) ?? UNKNOWN_MEMBER_COLOR
              }`}
            >
              {m.name}
            </span>
          ))
        )}
      </button>

      <Popover
        anchorRef={ref}
        open={open}
        onClose={() => setOpen(false)}
        className="w-48 p-1"
      >
        {options.map((m) => (
          <label
            key={m.id}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-neutral-50"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(m.id)}
              onChange={() => toggle(m.id)}
            />
            {m.name}
          </label>
        ))}
        {options.length === 0 && (
          <p className="px-2 py-1 text-sm text-neutral-400">
            No team members yet
          </p>
        )}
      </Popover>
    </div>
  );
}
