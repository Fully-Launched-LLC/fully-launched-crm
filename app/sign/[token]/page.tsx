import type { Metadata } from "next";
import "../sign.css";
import PdfPages from "@/components/sign/PdfPages";
import SignForm from "@/components/sign/SignForm";
import { defaultSelections, hasChoices } from "@/lib/deals/money";
import { markViewed, resolveToken } from "@/lib/deals/signing";
import { signedUrl } from "@/lib/deals/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Statement of Work | Fully Launched",
  robots: { index: false, follow: false, nocache: true },
};

// Public: no CRM account. Everything here is by token (service role).
export default async function SignPage({ params }: { params: { token: string } }) {
  const t = await resolveToken(params.token);

  if (t.state !== "open") {
    const copy = {
      invalid: { h: "This link doesn't work", p: "Check that you opened the full link, or ask Fully Launched for a new one." },
      revoked: { h: "This link is no longer active", p: "The agreement was updated. Fully Launched will send you a new link." },
      expired: { h: "This link has expired", p: "Ask Fully Launched for a new link to review and sign." },
      signed: { h: "Already signed", p: "This Statement of Work has been signed. You can download your copy below." },
    }[t.state];
    return (
      <Shell>
        <div className="card state">
          <h1>{copy.h}</h1>
          <p>{copy.p}</p>
          {t.state === "signed" && (
            <a className="btn primary" href={`/api/sign/${params.token}/download`}>
              Download the signed PDF
            </a>
          )}
        </div>
      </Shell>
    );
  }

  await markViewed(t);
  const [proposalUrl, sowUrl] = await Promise.all([
    signedUrl(t.proposal.frozen_pdf_path!, 900),
    signedUrl(t.sow.frozen_pdf_path!, 900),
  ]);
  const visibleItems = t.items;

  return (
    <Shell>
      <h1>{t.clientName}: Statement of Work</h1>
      <p className="lede">
        Please review the proposal summary and the Statement of Work, choose your package, then sign at the bottom of the
        page. This link is valid until {new Date(t.signature.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}.
      </p>
      <div className="card">
        <span className="doc-label">Proposal summary</span>
        <PdfPages url={proposalUrl} title="Proposal summary" />
      </div>
      <div className="card">
        <span className="doc-label">Statement of Work</span>
        <PdfPages url={sowUrl} title="Statement of Work" />
      </div>
      <SignForm
        token={params.token}
        items={visibleItems}
        defaults={defaultSelections(visibleItems).items}
        hasChoices={hasChoices(visibleItems)}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fl-sign">
      <div className="wrap">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/fl-logo-white.png" alt="Fully Launched" />
        </div>
        {children}
      </div>
    </div>
  );
}
