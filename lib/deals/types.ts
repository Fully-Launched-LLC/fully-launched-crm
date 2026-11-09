// Deal Desk types (migration 036). Shared by the CRM, the server routes and
// the public sign page. Amounts never leave the server toward Claude: see
// lib/deals/ai.ts.

export type DealStatus =
  | "draft"
  | "approved"
  | "sent"
  | "viewed"
  | "signed"
  | "countersigned"
  | "void";

export type DealBranch = "website" | "social" | "ai_tool" | "marketplace" | "other";
export type LineItemKind = "one_time" | "monthly" | "hourly";
export type DocKind = "proposal" | "sow" | "internal";

// Order sections appear in the SOW and the editor.
export const DEAL_BRANCHES: DealBranch[] = ["website", "marketplace", "social", "ai_tool", "other"];

// {{workstreams}} names (spec). "other" uses the item label instead.
export const DEAL_BRANCH_NAMES: Record<DealBranch, string> = {
  website: "Website Design and Development",
  marketplace: "Marketplace",
  social: "Social Media Management",
  ai_tool: "AI Tool Build",
  other: "Other",
};

export const LINE_ITEM_KIND_LABELS: Record<LineItemKind, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  hourly: "Hourly",
};

export type Deal = {
  id: string;
  project_id: string;
  lead_id: string | null;
  owner_id: string | null;
  status: DealStatus;
  date_issued: string;
  valid_through: string | null;
  target_start: string | null;
  target_launch: string | null;
  production_notice_days: number | null;
  production_setups: string | null;
  production_cancel_hours: number | null;
  est_project_hours: number | null;
  drive_folder_id: string | null;
  drive_folder_url: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DealLineItem = {
  id: string;
  deal_id: string;
  branch: DealBranch;
  label: string;
  description: string | null;
  tier_name: string | null;
  kind: LineItemKind;
  amount: number;
  hours_included: number | null;
  overage_rate: number | null;
  selected_by_default: boolean;
  optional: boolean;
  // Social only: the SOW keeps the production-day and travel sections, and
  // the deal's production fields are required (migration 038).
  includes_production_days: boolean;
  sort_order: number;
};

export type SectionFlags = {
  // AI sections that failed the no-prices check twice.
  needs_manual_edit?: string[];
  // "{{" / "[[" left in the Doc after generation.
  leftovers?: string[];
};

export type DealDocument = {
  id: string;
  deal_id: string;
  kind: DocKind;
  version: number;
  content_json: Record<string, unknown>;
  content_hash: string | null;
  google_doc_id: string | null;
  google_doc_url: string | null;
  template_doc_id: string | null;
  template_modified_at: string | null;
  frozen_pdf_path: string | null;
  frozen_at: string | null;
  drive_modified_at_approval: string | null;
  drive_file_id_pdf: string | null;
  source: "claude" | "manual" | "restore" | "computed";
  generated_by: string | null;
  model: string | null;
  section_flags: SectionFlags;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

export type DealSignature = {
  id: string;
  deal_id: string;
  document_id: string | null;
  proposal_document_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  viewed_at: string | null;
  signer_name: string | null;
  signer_title: string | null;
  signer_email: string | null;
  typed_signature: string | null;
  consent: boolean | null;
  consent_text: string | null;
  selections: Selections | null;
  content_hash: string | null;
  signed_at: string | null;
  ip: string | null;
  user_agent: string | null;
  pdf_path: string | null;
  fl_countersigned_by: string | null;
  fl_countersigner_name: string | null;
  fl_countersigner_title: string | null;
  fl_countersigned_at: string | null;
  final_pdf_path: string | null;
  created_at: string;
};

export type ProjectLinkKind =
  | "drive_folder"
  | "proposal_doc"
  | "sow_doc"
  | "proposal_pdf"
  | "sow_pdf"
  | "signed_pdf"
  | "final_pdf"
  | "internal_doc"
  | "other";

export type ProjectLink = {
  id: string;
  project_id: string;
  deal_id: string | null;
  document_id: string | null;
  kind: ProjectLinkKind;
  label: string;
  url: string;
  drive_file_id: string | null;
  source: "manual" | "system";
  created_by: string | null;
  created_at: string;
};

export type DealSettings = {
  project_hourly_rate: number | null;
  management_hourly_rate: number;
  commission_pct: number;
  earn_up_pct: number;
  earn_up_ends: string;
  default_overage_rate: number;
  updated_at: string;
};

export type DealEvent = {
  id: string;
  deal_id: string;
  kind: string;
  actor: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

// What the client picked at signature: the selected line item ids.
export type Selections = { items: string[] };

// Storage paths are kept in project_links.url as "storage:<path>" and opened
// through /api/deals/file (short-lived signed URL).
export const STORAGE_URL_PREFIX = "storage:";
export const DEAL_DOCS_BUCKET = "deal-docs";

export const CONSENT_TEXT =
  "I agree to sign this Statement of Work electronically, and I intend my typed name to be my legal signature.";
