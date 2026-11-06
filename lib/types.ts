import type { Branch, PaymentStatus, Role, Stage } from "@/lib/theme";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  booking_link: string | null;
  // Branches this person leads (migration 017). The Convert to Interested
  // modal defaults the project owner from it.
  lead_branches: Branch[];
  created_at: string;
};

export type Project = {
  id: string;
  client_name: string;
  branch: Branch | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  stage: Stage;
  lost_reason: string | null;
  owner: string[];
  salesperson: string[];
  source: string | null;
  // Branch-specific channels/platforms (migration 008); see lib/channels.ts.
  channels: string[] | null;
  value: number | null;
  end_date: string | null;
  target_date: string | null;
  scheduled_call: string | null;
  notes: string | null;

  build: boolean;
  build_value: number | null;
  payment_status: PaymentStatus | null;
  build_end_date: string | null;
  // Deposit = build_value * deposit_percent / 100 (migration 010).
  deposit_percent: number;
  // Stripe Invoices sent from the Build section (migration 010).
  stripe_deposit_invoice_id: string | null;
  stripe_build_invoice_id: string | null;

  subscription: boolean;
  subscription_value: number | null;
  deliver_date: string | null;

  commission_rate: number;

  // The company's business record in the Leads tab (leads.id). Several
  // projects can share one lead (same company, different engagements).
  // On delete set null.
  lead_id: string | null;

  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;

  created_at: string;
  updated_at: string;
};

export type ProjectTaskStatus = "Not Started" | "In Progress" | "Done";

export type ProjectTask = {
  id: string;
  project_id: string;
  task_name: string;
  owner: string | null;
  due_date: string | null;
  status: ProjectTaskStatus;
  notes: string | null;
  created_at: string;
};

export type Transaction = {
  id: string;
  project_id: string | null;
  amount: number;
  date: string;
  payer: string | null;
  payee: string | null;
  notes: string | null;
  created_at: string;
};

// leads (migration 017). `name` is the legacy display column, kept in step
// with `company` by the leads_normalize trigger; `contact_info` is the
// original free text, kept but no longer written.
export type LeadStatus =
  | "new"
  | "contacted"
  | "replied"
  | "interested"
  | "converted"
  | "not_interested"
  | "dead";

export type Lead = {
  id: string;
  name: string;
  source: string | null;
  contact_info: string | null;
  notes: string | null;
  created_at: string;
  company: string | null;
  contact_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  phone_digits: string | null;
  website: string | null;
  domain: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  category: string | null;
  branch_fit: Branch[];
  wheaton_alum: boolean;
  source_detail: string | null;
  external_ids: Record<string, string>;
  google_place_id: string | null;
  maps_url: string | null;
  rating: number | null;
  review_count: number | null;
  website_status: string | null;
  scan_tags: Record<string, unknown> | null;
  lead_score: number | null;
  priority_score: number | null;
  uses_servicetitan: boolean;
  audit: Record<string, unknown> | null;
  audit_at: string | null;
  status: LeadStatus;
  found_by: string | null;
  owner: string | null;
  project_id: string | null;
  last_touch_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  contact_linkedin: string | null; // migration 021
  owner_email: string | null; // migration 031: the owner's direct email (never from scans)
  owner_phone: string | null; // migration 031: the owner's direct line (never from scans)
  owner_since: string | null; // migration 030: when the current owner got it
  company_linkedin: string | null;
  updated_at: string;
};

export type Contact = {
  id: string;
  project_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  stage: Stage | null;
  created_at: string;
};

// Time clock (migration 014). Rows come from the time_entries_net view,
// which adds duration/adjustment/net minutes to each time_entries row.
export type TimeEntryType = "project" | "management" | "sales" | "internal";

export type TimeEntry = {
  id: string;
  user_id: string;
  project_id: string | null;
  entry_type: TimeEntryType;
  clock_in: string;
  clock_out: string | null;
  note: string | null;
  // "What did you accomplish?", required once clocked out (migration 015).
  accomplished: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

export type TimeEntryNet = TimeEntry & {
  duration_minutes: number;
  adjustment_minutes: number;
  deduction_count: number;
  net_minutes: number;
};

export type TimeEntryEdit = {
  id: string;
  time_entry_id: string;
  field: "clock_in" | "clock_out";
  old_value: string | null;
  new_value: string | null;
  reason: string;
  edited_by: string | null;
  edited_at: string;
};

export function isOverdue(project: Pick<Project, "target_date" | "stage">) {
  if (!project.target_date) return false;
  if (
    project.stage === "Complete" ||
    project.stage === "Subscriber" ||
    project.stage === "Lost"
  ) {
    return false;
  }
  return new Date(project.target_date) < new Date(new Date().toDateString());
}

export function isTaskOverdue(task: Pick<ProjectTask, "due_date" | "status">) {
  if (!task.due_date || task.status === "Done") return false;
  return new Date(task.due_date) < new Date(new Date().toDateString());
}
