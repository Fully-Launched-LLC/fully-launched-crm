import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { choiceGroups, money, priceText, totals } from "@/lib/deals/money";
import { DEAL_BRANCH_NAMES, type DealLineItem, type Selections } from "@/lib/deals/types";

// signed-v{n}.pdf / final-v{n}.pdf = frozen proposal (labeled Proposal
// Summary) + frozen SOW + Selections + Signatures + Audit Trail. The frozen
// PDFs are copied page for page; the last three pages are drawn here, with
// every amount from lib/deals/money.ts.

const INK = rgb(0.016, 0.063, 0.122); // FL navy #04101f
const SUB = rgb(0.35, 0.38, 0.42);
const LINE = rgb(0.8, 0.82, 0.85);

export type SignerInfo = {
  name: string;
  title: string;
  email: string;
  typed: string;
  signedAt: string; // ISO UTC
  ip: string;
  userAgent: string;
  consentText: string;
};

export type Countersign = { name: string; title: string; at: string } | null;

export type AuditInfo = {
  dealId: string;
  clientName: string;
  proposal: { version: number; hash: string | null };
  sow: { version: number; hash: string | null };
  contentHash: string;
  sentAt: string | null;
  viewedAt: string | null;
};

const W = 612;
const H = 792;
const M = 56;

class Writer {
  page: PDFPage;
  y = H - M;
  constructor(private doc: PDFDocument, private fonts: { regular: PDFFont; bold: PDFFont }) {
    this.page = doc.addPage([W, H]);
  }
  ensure(h: number) {
    if (this.y - h < M) {
      this.page = this.doc.addPage([W, H]);
      this.y = H - M;
    }
  }
  text(s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number; indent?: number } = {}) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const maxW = W - 2 * M - (opts.indent ?? 0);
    for (const line of wrap(clean(s), font, size, maxW)) {
      this.ensure(size * 1.4);
      this.page.drawText(line, { x: M + (opts.indent ?? 0), y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size * 1.4;
    }
    this.y -= opts.gap ?? 4;
  }
  rule() {
    this.ensure(12);
    this.page.drawLine({ start: { x: M, y: this.y - 4 }, end: { x: W - M, y: this.y - 4 }, thickness: 0.5, color: LINE });
    this.y -= 14;
  }
}

// WinAnsi can't encode everything; keep the drawn text to safe characters.
function clean(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

function wrap(s: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxW) line = next;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

async function scriptFont(doc: PDFDocument): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  const bytes = await readFile(path.join(process.cwd(), "lib/deals/fonts/GreatVibes-Regular.ttf"));
  return doc.embedFont(bytes, { subset: true });
}

const utc = (iso: string | null) => (iso ? new Date(iso).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC") : "-");

export async function buildSignaturePackage(args: {
  proposalPdf: Uint8Array;
  sowPdf: Uint8Array;
  items: DealLineItem[];
  selections: Selections;
  signer: SignerInfo;
  countersign: Countersign;
  audit: AuditInfo;
}): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const regular = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const script = await scriptFont(out);

  // Frozen proposal, labeled.
  const proposal = await PDFDocument.load(args.proposalPdf);
  const pp = await out.copyPages(proposal, proposal.getPageIndices());
  pp.forEach((p, i) => {
    out.addPage(p);
    if (i === 0) {
      const { height } = p.getSize();
      p.drawText("PROPOSAL SUMMARY", { x: 24, y: height - 18, size: 8, font: bold, color: SUB });
    }
  });
  const sow = await PDFDocument.load(args.sowPdf);
  for (const p of await out.copyPages(sow, sow.getPageIndices())) out.addPage(p);

  // Selections.
  const w = new Writer(out, { regular, bold });
  const chosen = new Set(args.selections.items);
  w.text("Selections", { size: 18, bold: true, gap: 6 });
  w.text(`${args.audit.clientName} selected the following at signature. Only selected items are contracted.`, { color: SUB, gap: 10 });
  for (const g of choiceGroups(args.items)) {
    w.text(g.branch === "other" ? "Other" : DEAL_BRANCH_NAMES[g.branch], { bold: true, size: 12, gap: 2 });
    const all = [...g.required, ...g.tiers, ...g.optional];
    for (const i of all) {
      const label = i.tier_name ? `${i.label}: ${i.tier_name}` : i.label;
      w.text(`${chosen.has(i.id) ? "[x]" : "[ ]"} ${label}: ${priceText(i)}${chosen.has(i.id) ? "" : " (declined)"}`, {
        indent: 12,
        gap: 1,
      });
    }
    if (g.tiers.length && !g.tiers.some((t) => chosen.has(t.id))) w.text("Tiers declined", { indent: 12, color: SUB });
    w.y -= 6;
  }
  const t = totals(args.items, args.selections);
  w.rule();
  w.text(`One-time total: ${money(t.oneTime)}`, { bold: true, gap: 1 });
  if (t.oneTime > 0) {
    w.text(`Deposit at signature (50%): ${money(t.deposit)}`, { gap: 1 });
    w.text(`Due at launch (50%): ${money(t.dueAtLaunch)}`, { gap: 1 });
  }
  w.text(`Monthly total: ${money(t.monthly)} per month`, { bold: true, gap: 1 });
  for (const h of t.hourly) w.text(`${h.label}: ${priceText(h)}`, { gap: 1 });

  // Signatures.
  const s = new Writer(out, { regular, bold });
  s.text("Signatures", { size: 18, bold: true, gap: 6 });
  s.text("By signing below, both parties agree to the scope, fees, timeline, and terms set out in this Statement of Work.", {
    color: SUB,
    gap: 18,
  });
  const block = (title: string, sig: string | null, rows: [string, string][]) => {
    s.text(title, { bold: true, size: 12, gap: 6 });
    s.ensure(60);
    if (sig) s.page.drawText(clean(sig), { x: M, y: s.y - 30, size: 30, font: script, color: INK });
    else s.page.drawText("Pending countersignature", { x: M, y: s.y - 24, size: 11, font: regular, color: SUB });
    s.y -= 40;
    s.rule();
    for (const [k, v] of rows) s.text(`${k}: ${v}`, { gap: 1 });
    s.y -= 18;
  };
  block(args.audit.clientName, args.signer.typed, [
    ["Name", args.signer.name],
    ["Title", args.signer.title],
    ["Email", args.signer.email],
    ["Signed", utc(args.signer.signedAt)],
  ]);
  block(
    "Fully Launched",
    args.countersign ? args.countersign.name : null,
    args.countersign
      ? [
          ["Name", args.countersign.name],
          ["Title", args.countersign.title],
          ["Signed", utc(args.countersign.at)],
        ]
      : []
  );

  // Audit trail.
  const a = new Writer(out, { regular, bold });
  a.text("Audit Trail", { size: 18, bold: true, gap: 10 });
  const rows: [string, string][] = [
    ["Deal ID", args.audit.dealId],
    ["Proposal", `v${args.audit.proposal.version}, frozen PDF sha256 ${args.audit.proposal.hash ?? "-"}`],
    ["Statement of Work", `v${args.audit.sow.version}, frozen PDF sha256 ${args.audit.sow.hash ?? "-"}`],
    ["Signed content hash (SOW + selections)", args.audit.contentHash],
    ["Link sent", utc(args.audit.sentAt)],
    ["First viewed", utc(args.audit.viewedAt)],
    ["Signer", `${args.signer.name}, ${args.signer.title}, ${args.signer.email}`],
    ["Typed signature", args.signer.typed],
    ["Signed at", utc(args.signer.signedAt)],
    ["IP address", args.signer.ip],
    ["User agent", args.signer.userAgent],
    ["Consent", args.signer.consentText],
  ];
  if (args.countersign)
    rows.push(["Countersigned", `${args.countersign.name}, ${args.countersign.title}, ${utc(args.countersign.at)}`]);
  for (const [k, v] of rows) {
    a.text(k, { bold: true, size: 9.5, gap: 0 });
    a.text(v, { size: 9.5, gap: 6 });
  }

  out.setTitle(`${args.audit.clientName} - Statement of Work (signed)`);
  out.setProducer("Fully Launched CRM");
  return out.save();
}
