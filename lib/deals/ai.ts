import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { DealBranch, DocKind } from "@/lib/deals/types";

// Claude writes the words, never the prices. What goes in: the business,
// recent Granola notes, line items WITHOUT amounts, deal dates. Every text
// sent is also scrubbed of money patterns (a description or a meeting note
// can mention a price). What comes out is checked for prices; a failing
// section is retried once, then marked "needs manual edit".

export const DOCS_MODEL = () => process.env.DOCS_MODEL || "claude-sonnet-5-5";
export const docsKeyConfigured = () => !!process.env.ANTHROPIC_API_KEY_DOCS;

export const PHASE_NAMES = [
  "Discovery & Access Setup",
  "Core Build",
  "Testing & Refinement",
  "Deployment & Handoff",
] as const;

export const MANUAL_EDIT = "[[NEEDS MANUAL EDIT]]";

// ---- Input -----------------------------------------------------------------

export type AiLineItem = {
  id: string;
  branch: DealBranch;
  label: string;
  tier_name: string | null;
  kind: string;
  description: string | null;
  hours_included: number | null;
};

export type AiInput = {
  kind: Exclude<DocKind, "internal">;
  company: {
    name: string;
    contact_name: string | null;
    category: string | null;
    city: string | null;
    website: string | null;
    notes: string | null;
  };
  meetings: { title: string | null; date: string | null; notes: string }[];
  line_items: AiLineItem[];
  dates: {
    date_issued: string;
    target_start: string | null;
    target_launch: string | null;
  };
};

const MONEY_IN_TEXT = /\$\s?\d[\d,]*(\.\d+)?\s?(k|m)?\b|\b\d[\d,]*(\.\d+)?\s?(dollars|usd)\b/gi;

export function redactPrices(s: string | null | undefined): string | null {
  if (s == null) return null;
  return s.replace(MONEY_IN_TEXT, "[amount]");
}

// ---- Output schemas ----------------------------------------------------------

const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;
const phase = {
  type: "object",
  properties: { name: { type: "string", enum: [...PHASE_NAMES] }, bullets: strArr },
  required: ["name", "bullets"],
  additionalProperties: false,
} as const;

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    project_goal: str,
    overview: str,
    phases: { type: "array", items: phase },
    expected_outcomes: strArr,
    timeline: {
      type: "object",
      properties: { estimate: str, meeting_cadence: str },
      required: ["estimate", "meeting_cadence"],
      additionalProperties: false,
    },
    retainer_covers: str,
  },
  required: ["project_goal", "overview", "phases", "expected_outcomes", "timeline", "retainer_covers"],
  additionalProperties: false,
} as const;

const SOW_SCHEMA = {
  type: "object",
  properties: {
    brand_sentence: str,
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          branch: { type: "string", enum: ["website", "marketplace", "social", "ai_tool", "other"] },
          intro: str,
          deliverables: {
            type: "array",
            items: {
              type: "object",
              properties: { item_id: str, bullets: strArr },
              required: ["item_id", "bullets"],
              additionalProperties: false,
            },
          },
          covers: str,
          phases: { type: "array", items: phase },
        },
        required: ["branch", "intro", "deliverables", "covers", "phases"],
        additionalProperties: false,
      },
    },
    timeline_rows: {
      type: "array",
      items: {
        type: "object",
        properties: { period: str, dates: str, milestone: str },
        required: ["period", "dates", "milestone"],
        additionalProperties: false,
      },
    },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        properties: { dependency: str, detail: str },
        required: ["dependency", "detail"],
        additionalProperties: false,
      },
    },
    change_request_services: {
      type: "array",
      items: {
        type: "object",
        properties: {
          branch: { type: "string", enum: ["website", "marketplace", "social", "ai_tool", "other"] },
          service: str,
          approval: str,
        },
        required: ["branch", "service", "approval"],
        additionalProperties: false,
      },
    },
    assumptions: str,
  },
  required: ["brand_sentence", "sections", "timeline_rows", "dependencies", "change_request_services", "assumptions"],
  additionalProperties: false,
} as const;

export type ProposalContent = {
  project_goal: string;
  overview: string;
  phases: { name: string; bullets: string[] }[];
  expected_outcomes: string[];
  timeline: { estimate: string; meeting_cadence: string };
  retainer_covers: string;
};

export type SowSection = {
  branch: DealBranch;
  intro: string;
  deliverables: { item_id: string; bullets: string[] }[];
  covers: string;
  phases: { name: string; bullets: string[] }[];
};

export type SowContent = {
  brand_sentence: string;
  sections: SowSection[];
  timeline_rows: { period: string; dates: string; milestone: string }[];
  dependencies: { dependency: string; detail: string }[];
  change_request_services: { branch: DealBranch; service: string; approval: string }[];
  assumptions: string;
};

export const PROPOSAL_SECTIONS = Object.keys(PROPOSAL_SCHEMA.properties);
export const SOW_SECTIONS = Object.keys(SOW_SCHEMA.properties);

// ---- Price check ---------------------------------------------------------------

// Spec: reject "$", "/hr", "per hour", "per month", or a number followed by k.
const PRICE_PATTERN = /\$|\/\s?hr\b|per hour|per month|\b\d+(\.\d+)?\s?k\b/i;

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

export function sectionHasPrice(v: unknown): boolean {
  return strings(v).some((s) => PRICE_PATTERN.test(s));
}

// ---- Prompt ------------------------------------------------------------------

const SYSTEM = `You write client documents for Fully Launched, a small digital agency (websites, marketplaces, social media management, and AI tools for small businesses).

Voice: plain, warm, client-friendly. Short sentences. No jargon, no hype, no em-dashes.

Hard rules:
- Never write prices, dollar figures, rates, or numbers of dollars. No "$", no "per hour", no "per month", no "5k". Pricing is added separately by our system.
- Never write legal terms (payment terms, termination, ownership, liability). Those come from a fixed template.
- Use only facts from the meeting notes and line items you are given. Do not invent names, numbers, tools, results, or dates.
- If information is missing, write one short neutral line instead of guessing.
- Always answer by calling the write_document tool exactly once.`;

function instructions(input: AiInput): string {
  if (input.kind === "proposal") {
    return `Write the proposal content.
- project_goal: one sentence.
- overview: one short paragraph.
- phases: exactly four, in this order and with these names: ${PHASE_NAMES.join(", ")}. Two to four bullets each.
- expected_outcomes: three to five bullets.
- timeline: estimate (a duration such as "About six weeks from kickoff", only if the dates or notes support it) and meeting_cadence.
- retainer_covers: what an ongoing monthly retainer covers, in words only. Empty string if there is no monthly item.`;
  }
  return `Write the Statement of Work content.
- brand_sentence: one sentence describing the client's business.
- sections: one per branch present in the line items (branches: ${Array.from(new Set(input.line_items.map((i) => i.branch))).join(", ")}). intro: two or three sentences. deliverables: one entry per line item of that branch (item_id = the line item id), with two to five concrete bullets. covers: for website, what monthly maintenance covers; for marketplace, what the retainer covers; else "". phases: for ai_tool only, exactly four phases named ${PHASE_NAMES.join(", ")}; else [].
- timeline_rows: the milestones between Week 1 and Launch (period like "Weeks 2-3", dates as a short range or "TBD", milestone).
- dependencies: always include "Executed SOW and first payment", "Admin access", and "Approvals within 2 business days", plus anything from the notes.
- change_request_services: typical extra requests per branch (service, and how approval works, e.g. "Quoted and approved by email").
- assumptions: a short "Assumptions Used in Pricing" paragraph, with no numbers or prices.`;
}

function userPayload(input: AiInput, fixKeys?: string[]): string {
  const data = {
    company: input.company,
    meetings: input.meetings,
    line_items: input.line_items,
    dates: input.dates,
  };
  return [
    instructions(input),
    fixKeys?.length
      ? `Your previous answer put prices or rates in: ${fixKeys.join(", ")}. Rewrite those with no prices, dollar amounts, rates, or "per month" / "per hour" wording.`
      : "",
    "Data (JSON):",
    JSON.stringify(data, null, 2),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---- Call --------------------------------------------------------------------

async function callOnce(client: Anthropic, input: AiInput, fixKeys?: string[]): Promise<Record<string, unknown>> {
  const model = DOCS_MODEL();
  const schema = input.kind === "proposal" ? PROPOSAL_SCHEMA : SOW_SCHEMA;
  const content = userPayload(input, fixKeys);

  // Dev only: log exactly what goes to Anthropic, to confirm no amounts.
  if (process.env.NODE_ENV !== "production") {
    console.log(`[deal-docs] Anthropic request (${input.kind}, ${model}):\n${content}`);
  }

  const useFallback = /^claude-(sonnet-5-5|opus-5|fable-5-1)/.test(model);
  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [
      {
        name: "write_document",
        description: `Return the ${input.kind === "proposal" ? "proposal" : "SOW"} content as structured JSON.`,
        strict: true,
        input_schema: schema as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    // Forced tool_choice is not supported on current models: auto + the
    // instruction in the system prompt + strict schema.
    tool_choice: { type: "auto" as const },
    messages: [{ role: "user" as const, content }],
    ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
  };
  const response = (await client.beta.messages.create(
    params as unknown as Parameters<typeof client.beta.messages.create>[0]
  )) as Anthropic.Beta.BetaMessage;

  if (response.stop_reason === "refusal") throw new Error("The model declined to write this document");
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("The model did not return the document");
  return block.input as Record<string, unknown>;
}

export type AiResult = { content: Record<string, unknown>; needsManualEdit: string[]; model: string };

export async function generateContent(input: AiInput): Promise<AiResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY_DOCS });
  const content = await callOnce(client, input);
  let bad = Object.keys(content).filter((k) => sectionHasPrice(content[k]));
  if (bad.length) {
    const retry = await callOnce(client, input, bad);
    for (const k of bad) if (!sectionHasPrice(retry[k])) content[k] = retry[k];
    bad = bad.filter((k) => sectionHasPrice(content[k]));
    for (const k of bad) content[k] = manualPlaceholder(content[k]);
  }
  return { content, needsManualEdit: bad, model: DOCS_MODEL() };
}

// Keys that identify things (kept as is): branch, item_id, phase name.
const ID_KEYS = new Set(["branch", "item_id", "name"]);

function manualPlaceholder(v: unknown): unknown {
  if (typeof v === "string") return PRICE_PATTERN.test(v) ? MANUAL_EDIT : v;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) {
      const kept = (v as string[]).filter((s) => !PRICE_PATTERN.test(s));
      return kept.length === v.length ? v : [...kept, MANUAL_EDIT];
    }
    return v.map(manualPlaceholder);
  }
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, ID_KEYS.has(k) ? x : manualPlaceholder(x)])
    );
  return v;
}
