import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { exportPdf, fileMeta, fileUrl, getDoc, leftovers, replaceDates, uploadPdf } from "@/lib/deals/google";
import { computeInternal } from "@/lib/deals/internal";
import { DATE_RANGES, dealBlockers, fmtDate } from "@/lib/deals/render";
import { latestDoc, loadDeal, sha256, uploadToStorage, type DealBundle } from "@/lib/deals/server";
import { logDealEvent } from "@/lib/deals/events";
import type { DealDocument } from "@/lib/deals/types";

type Db = ReturnType<typeof createClient>;

// Everything that blocks approval: deal fields, and the current Docs' live
// text ("{{" / "[[" left, which covers "needs manual edit" placeholders).
export async function approvalBlockers(b: DealBundle): Promise<string[]> {
  const out = dealBlockers(b.deal, b.items);
  for (const kind of ["proposal", "sow"] as const) {
    const doc = latestDoc(b.docs, kind);
    const label = kind === "proposal" ? "Proposal" : "SOW";
    if (!doc?.google_doc_id) {
      out.push(`Generate the ${label} first.`);
      continue;
    }
    const left = leftovers(await getDoc(doc.google_doc_id));
    if (left.length)
      out.push(`${label} v${doc.version} still has placeholders to edit in Google Docs: ${left.slice(0, 6).join(", ")}`);
  }
  return out;
}

// Approve, in order (spec): a) deal -> approved (trigger refreshes dates);
// b) dates into the Docs' named ranges; c) modifiedTime after b, export PDF,
// upload to deal-docs and the client folder; d) freeze the document rows;
// e) internal snapshot. Any failure sets the deal back to draft.
export async function approveDeal(db: Db, b: DealBundle, memberId: string) {
  const blockers = await approvalBlockers(b);
  if (blockers.length) return { blockers };

  const { error: approveErr } = await db
    .from("deals")
    .update({ status: "approved", approved_by: memberId, approved_at: new Date().toISOString() })
    .eq("id", b.deal.id);
  if (approveErr) throw new Error(approveErr.message);

  try {
    const fresh = (await loadDeal(db, b.deal.id))!;
    const dates = {
      [DATE_RANGES.issued]: fmtDate(fresh.deal.date_issued),
      [DATE_RANGES.valid]: fmtDate(fresh.deal.valid_through),
    };
    const frozen: DealDocument[] = [];
    for (const kind of ["proposal", "sow"] as const) {
      const doc = latestDoc(fresh.docs, kind)!;
      await replaceDates(doc.google_doc_id!, dates);
      const meta = await fileMeta(doc.google_doc_id!);
      const pdf = await exportPdf(doc.google_doc_id!);
      const path = `${fresh.deal.id}/frozen-${kind}-v${doc.version}.pdf`;
      await uploadToStorage(path, pdf);
      const pdfName = `${(meta.name ?? kind).replace(/\.pdf$/i, "")} (approved).pdf`;
      const driveId = await uploadPdf(pdf, pdfName, fresh.deal.drive_folder_id!);
      const now = new Date().toISOString();
      const { data: updated, error } = await db
        .from("deal_documents")
        .update({
          approved_by: memberId,
          approved_at: now,
          frozen_pdf_path: path,
          content_hash: sha256(pdf),
          frozen_at: now,
          drive_modified_at_approval: meta.modifiedTime,
          drive_file_id_pdf: driveId,
        })
        .eq("id", doc.id)
        .select("*")
        .single();
      if (error || !updated) throw new Error(error?.message ?? "Could not freeze the document");
      frozen.push(updated as DealDocument);
      await db.from("project_links").insert({
        project_id: fresh.project.id,
        deal_id: fresh.deal.id,
        document_id: doc.id,
        kind: kind === "proposal" ? "proposal_pdf" : "sow_pdf",
        label: pdfName,
        url: fileUrl(driveId),
        drive_file_id: driveId,
        source: "system",
      });
    }

    const internal = computeInternal(fresh.deal, fresh.items, fresh.settings);
    const lastInternal = latestDoc(fresh.docs, "internal");
    await db.from("deal_documents").insert({
      deal_id: fresh.deal.id,
      kind: "internal",
      version: (lastInternal?.version ?? 0) + 1,
      content_json: internal,
      source: "computed",
      approved_by: memberId,
      approved_at: new Date().toISOString(),
    });
    await logDealEvent(db, fresh.deal.id, memberId, "approved", {
      proposal_version: frozen[0].version,
      sow_version: frozen[1].version,
      date_issued: fresh.deal.date_issued,
      valid_through: fresh.deal.valid_through,
    });
    return { deal: fresh.deal, documents: frozen };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Approval failed";
    await db.rpc("reset_deal_to_draft", { p_deal_id: b.deal.id, p_cause: `Approval failed: ${msg}`.slice(0, 200) });
    throw e;
  }
}

// Google Docs edited after approval? Compares each approved Doc's current
// modifiedTime with drive_modified_at_approval. If newer: reset the deal to
// draft (the trigger revokes unsigned links).
export async function detectDocEdits(db: Db, b: DealBundle): Promise<string[]> {
  if (!["approved", "sent", "viewed"].includes(b.deal.status)) return [];
  const edited: string[] = [];
  for (const kind of ["proposal", "sow"] as const) {
    const doc = latestDoc(b.docs, kind);
    if (!doc?.google_doc_id || !doc.drive_modified_at_approval) continue;
    const meta = await fileMeta(doc.google_doc_id);
    if (meta.modifiedTime && new Date(meta.modifiedTime) > new Date(doc.drive_modified_at_approval))
      edited.push(`${kind === "proposal" ? "Proposal" : "SOW"} v${doc.version}`);
  }
  if (edited.length) {
    await db.rpc("reset_deal_to_draft", {
      p_deal_id: b.deal.id,
      p_cause: `Edited in Google Docs after approval: ${edited.join(", ")}`,
    });
  }
  return edited;
}
