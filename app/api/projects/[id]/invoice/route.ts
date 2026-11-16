import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTeamMember } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import {
  INVOICE_DAYS_UNTIL_DUE,
  STATUS_AFTER_SEND,
  canSendInvoices,
  invoiceCents,
  invoiceIdField,
  type InvoiceKind,
} from "@/lib/billing";
import type { Project } from "@/lib/types";

// POST /api/projects/[id]/invoice  { kind: "deposit" | "build" }
//
// Creates, finalizes and emails a Stripe Invoice for the project's Deposit or
// Build balance. Admin/Manager only — enforced here, server-side; the UI
// check only hides the buttons. Stripe emails the invoice (collection_method
// "send_invoice"), so nothing is ever charged automatically.
//
// Every Stripe write carries an idempotency key, so a double-click or retry
// within 24h replays the same invoice instead of sending a second one.

export const dynamic = "force-dynamic";

type SupabaseServer = ReturnType<typeof createClient>;

function fail(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

function normalizeCompany(name: string): string {
  return name.trim().toLowerCase();
}

// One Stripe Customer per company, matched by client_name (trimmed,
// case-insensitive): reuse this project's customer, else any other project of
// the same company that has one, else create one. The customer's email is
// set to this project's contact email on every send — Stripe emails invoices
// to the customer's address, so the most recent send's contact wins.
async function resolveCustomer(
  supabase: SupabaseServer,
  stripe: Stripe,
  project: Project,
  email: string
): Promise<string> {
  let customerId = project.stripe_customer_id;

  if (!customerId) {
    const { data: others, error } = await supabase
      .from("projects")
      .select("client_name, stripe_customer_id")
      .not("stripe_customer_id", "is", null);
    if (error) throw new Error(error.message);
    const company = normalizeCompany(project.client_name);
    customerId =
      others?.find((o) => normalizeCompany(o.client_name) === company)
        ?.stripe_customer_id ?? null;
  }

  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        name: project.client_name.trim(),
        email,
        metadata: { company: normalizeCompany(project.client_name) },
      },
      { idempotencyKey: `customer-${project.id}` }
    );
    customerId = customer.id;
  } else {
    await stripe.customers.update(customerId, { email });
  }

  if (customerId !== project.stripe_customer_id) {
    const { error } = await supabase
      .from("projects")
      .update({ stripe_customer_id: customerId })
      .eq("id", project.id);
    if (error) throw new Error(error.message);
  }

  return customerId;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const member = await getCurrentTeamMember();
  if (!member) return fail(401, "Not signed in.");
  if (!canSendInvoices(member.role)) {
    return fail(403, "Only Admins and Managers can send invoices.");
  }

  const body = (await request.json().catch(() => null)) as {
    kind?: unknown;
  } | null;
  const kind = body?.kind;
  if (kind !== "deposit" && kind !== "build") {
    return fail(400, 'kind must be "deposit" or "build".');
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Project not found.");
  const project = data as Project;

  const email = project.email?.trim();
  if (!project.build) return fail(400, "Build isn't turned on for this project.");
  if (!email) return fail(400, "Add a contact email before sending an invoice.");
  const amount = invoiceCents(project, kind);
  if (amount <= 0) return fail(400, "Set a Build Value before sending an invoice.");

  const idField = invoiceIdField(kind);
  if (project[idField]) {
    return fail(409, `A ${kind} invoice was already sent for this project.`);
  }

  const label: Record<InvoiceKind, string> = {
    deposit: `Deposit (${project.deposit_percent}%)`,
    build: "Build balance",
  };
  const description = `${label[kind]} — ${project.client_name.trim()}`;

  // payment_status is Admin-only in the database (migration 042), but Managers
  // send invoices too. After the role check above, the status write goes
  // through the service-role client. Created before anything is sent, so a
  // missing key fails here instead of after Stripe has emailed the invoice.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : String(e));
  }

  try {
    const stripe = getStripe();
    const customer = await resolveCustomer(supabase, stripe, project, email);

    let invoice = await stripe.invoices.create(
      {
        customer,
        collection_method: "send_invoice",
        days_until_due: INVOICE_DAYS_UNTIL_DUE,
        // Only the line added below — never sweep in stray pending items.
        pending_invoice_items_behavior: "exclude",
        auto_advance: false,
        description,
        metadata: { project_id: project.id, kind },
      },
      { idempotencyKey: `invoice-${project.id}-${kind}` }
    );

    if (invoice.status === "draft") {
      await stripe.invoiceItems.create(
        {
          customer,
          invoice: invoice.id,
          amount,
          currency: "usd",
          description,
        },
        { idempotencyKey: `invoice-line-${invoice.id}` }
      );
      invoice = await stripe.invoices.finalizeInvoice(invoice.id, {
        auto_advance: false,
      });
    }

    if (invoice.status === "open") {
      invoice = await stripe.invoices.sendInvoice(invoice.id, undefined, {
        idempotencyKey: `invoice-send-${invoice.id}`,
      });
    }

    const patch = {
      [idField]: invoice.id,
      payment_status: STATUS_AFTER_SEND[kind],
    };
    // Service role: this row was already read with the caller's session
    // (RLS), and the caller's role was checked above.
    const { error: saveError } = await admin
      .from("projects")
      .update(patch)
      .eq("id", project.id);
    if (saveError) {
      // The invoice is already sent — surface that rather than a bare error,
      // so nobody resends it. The webhook still matches it by metadata.
      console.error("Invoice sent but not saved", invoice.id, saveError);
      return fail(
        500,
        `Invoice ${invoice.id} was sent, but saving it to the project failed: ${saveError.message}`
      );
    }

    return Response.json({
      ok: true,
      invoiceId: invoice.id,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      patch: { ...patch, stripe_customer_id: customer },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Stripe invoice send failed", project.id, kind, message);
    return fail(502, `Stripe: ${message}`);
  }
}
