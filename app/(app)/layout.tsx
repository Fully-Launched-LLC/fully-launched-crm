import TopNav from "@/components/TopNav";
import { getCurrentTeamMember } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const teamMember = await getCurrentTeamMember();

  return (
    <div className="min-h-screen bg-background">
      <TopNav
        isAdmin={teamMember?.role === "Admin"}
        memberId={teamMember?.id ?? null}
      />
      {children}
    </div>
  );
}
