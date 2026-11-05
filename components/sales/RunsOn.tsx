import { softwareGroups } from "@/lib/lead-finder/software";

// "Runs on: Housecall Pro · Podium · GoHighLevel" (results, side preview,
// dossier). Tools in group order; hovering shows the groups.
export default function RunsOn({ tech }: { tech: string[] | null | undefined }) {
  const groups = softwareGroups(tech);
  if (!groups.length) return null;
  return (
    <span className="badge-st runs-on" title={groups.map((g) => `${g.label}: ${g.tools.join(", ")}`).join("\n")}>
      Runs on: {groups.flatMap((g) => g.tools).join(" · ")}
    </span>
  );
}
