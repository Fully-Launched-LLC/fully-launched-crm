import "server-only";
// Per-API packages, not "googleapis": its types for every Google API ran the
// Next type check out of memory.
import { docs as docsApi, type docs_v1 } from "@googleapis/docs";
import { drive as driveApi, type drive_v3 } from "@googleapis/drive";
import { JWT } from "google-auth-library";
import { Readable } from "node:stream";

// Google Drive / Docs through a service account (GOOGLE_SERVICE_ACCOUNT_JSON_B64)
// in the "FL Client Docs" Shared Drive. Every Drive call passes
// supportsAllDrives. Server only.

const SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/documents"];

// Env vars the Deal Desk needs. A value that is empty, or looks like a
// variable name instead of an ID (e.g. GOOGLE_DRIVE_CLIENTS_FOLDER_ID set to
// its own name), fails with a message naming the variable, instead of
// Google's "File not found: .".
const BASE_VARS = ["GOOGLE_SERVICE_ACCOUNT_JSON_B64", "GOOGLE_DRIVE_TEMPLATES_FOLDER_ID", "GOOGLE_DRIVE_CLIENTS_FOLDER_ID"];
const TEMPLATE_VAR = { proposal: "GOOGLE_DOCS_PROPOSAL_TEMPLATE_ID", sow: "GOOGLE_DOCS_SOW_TEMPLATE_ID" } as const;

function envProblem(name: string): string | null {
  const v = (process.env[name] ?? "").trim();
  if (!v) return `${name} is not set`;
  if (v === name || /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(v) || /^\$|^\{\{|^<.*>$/.test(v))
    return `${name} looks like a variable name ("${v.slice(0, 40)}"), not a value. Set it to the real ID in Vercel and redeploy.`;
  if (name === "GOOGLE_SERVICE_ACCOUNT_JSON_B64") {
    try {
      const c = JSON.parse(Buffer.from(v, "base64").toString("utf8"));
      if (!c.client_email || !c.private_key) return `${name} decodes, but has no client_email / private_key`;
    } catch {
      return `${name} is not base64-encoded service account JSON`;
    }
  } else if (!/^[A-Za-z0-9_-]{10,}$/.test(v)) {
    return `${name} doesn't look like a Google Drive ID ("${v.slice(0, 40)}")`;
  }
  return null;
}

// Every problem with the Google env (both templates unless kind is given).
export function googleEnvProblems(kind?: "proposal" | "sow" | "all"): string[] {
  const names = [...BASE_VARS];
  if (kind === "proposal" || kind === "sow") names.push(TEMPLATE_VAR[kind]);
  else if (kind === "all") names.push(TEMPLATE_VAR.proposal, TEMPLATE_VAR.sow);
  return names.map(envProblem).filter((x): x is string => !!x);
}

export function googleConfigured(kind?: "proposal" | "sow"): boolean {
  return googleEnvProblems(kind).length === 0;
}

// Throws one clear error naming every bad variable.
export function assertGoogleEnv(kind?: "proposal" | "sow" | "all") {
  const p = googleEnvProblems(kind);
  if (p.length) throw new Error(`Google Docs setup: ${p.join("; ")}`);
}

// Settings > Deal Desk health check: env, then each folder / template by ID.
export async function driveHealth(): Promise<{ label: string; ok: boolean; detail: string }[]> {
  const problems = googleEnvProblems("all");
  if (problems.length) return problems.map((p) => ({ label: p.split(" ")[0], ok: false, detail: p }));
  const checks = [
    { label: "Templates folder", name: "GOOGLE_DRIVE_TEMPLATES_FOLDER_ID" },
    { label: "Clients folder", name: "GOOGLE_DRIVE_CLIENTS_FOLDER_ID" },
    { label: "CRM Master Proposal", name: TEMPLATE_VAR.proposal },
    { label: "CRM Master SOW", name: TEMPLATE_VAR.sow },
  ];
  const out: { label: string; ok: boolean; detail: string }[] = [];
  for (const c of checks) {
    try {
      const m = await fileMeta(process.env[c.name]!.trim());
      out.push({ label: c.label, ok: true, detail: `${m.name} (${m.mimeType?.replace("application/vnd.google-apps.", "")})` });
    } catch (e) {
      out.push({ label: c.label, ok: false, detail: `${c.name}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  console.log("[deal-docs] drive check", JSON.stringify(out));
  return out;
}

let cached: { drive: drive_v3.Drive; docs: docs_v1.Docs } | null = null;

export function gapi() {
  if (cached) return cached;
  assertGoogleEnv();
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64!.trim();
  const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as {
    client_email: string;
    private_key: string;
  };
  const auth = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
  cached = { drive: driveApi({ version: "v3", auth }), docs: docsApi({ version: "v1", auth }) };
  return cached;
}

const ALL = { supportsAllDrives: true } as const;
const LIST = { supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives" } as const;

export const docUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;
export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
export const fileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// Drive folder names can't hold "/" meaningfully; keep them readable.
export const safeName = (s: string) => s.replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim() || "Untitled";

export async function findChild(parentId: string, name: string, mimeType?: string) {
  const { drive } = gapi();
  const res = await drive.files.list({
    ...LIST,
    q: `'${q(parentId)}' in parents and name = '${q(name)}' and trashed = false${
      mimeType ? ` and mimeType = '${mimeType}'` : ""
    }`,
    fields: "files(id, name, modifiedTime)",
    pageSize: 10,
  });
  return res.data.files ?? [];
}

const FOLDER = "application/vnd.google-apps.folder";

export async function ensureFolder(parentId: string, name: string): Promise<string> {
  const existing = await findChild(parentId, name, FOLDER);
  if (existing[0]?.id) return existing[0].id;
  const { drive } = gapi();
  const res = await drive.files.create({
    ...ALL,
    requestBody: { name, mimeType: FOLDER, parents: [parentId] },
    fields: "id",
  });
  return res.data.id!;
}

// Clients/{Company} and Clients/{Company}/Internal.
export async function ensureClientFolders(company: string) {
  assertGoogleEnv();
  const clients = process.env.GOOGLE_DRIVE_CLIENTS_FOLDER_ID!.trim();
  const folderId = await ensureFolder(clients, safeName(company));
  const internalId = await ensureFolder(folderId, "Internal");
  return { folderId, folderUrl: folderUrl(folderId), internalId };
}

export async function fileMeta(fileId: string) {
  const { drive } = gapi();
  const res = await drive.files.get({ ...ALL, fileId, fields: "id, name, modifiedTime, mimeType" });
  return res.data;
}

export async function copyFile(fileId: string, name: string, parentId: string): Promise<string> {
  const { drive } = gapi();
  const res = await drive.files.copy({ ...ALL, fileId, requestBody: { name, parents: [parentId] }, fields: "id" });
  return res.data.id!;
}

export async function exportPdf(docId: string): Promise<Buffer> {
  const { drive } = gapi();
  const res = await drive.files.export(
    { fileId: docId, mimeType: "application/pdf" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

export async function uploadPdf(pdf: Uint8Array, name: string, parentId: string): Promise<string> {
  const { drive } = gapi();
  const res = await drive.files.create({
    ...ALL,
    requestBody: { name, parents: [parentId], mimeType: "application/pdf" },
    media: { mimeType: "application/pdf", body: Readable.from(Buffer.from(pdf)) },
    fields: "id",
  });
  return res.data.id!;
}

// ---- Docs structure helpers -------------------------------------------------

type El = docs_v1.Schema$StructuralElement;

export type Para = {
  start: number;
  end: number;
  text: string;
  style: string | null;
  inTable: boolean;
};

// Every paragraph in the body, tables included, in document order.
export function paragraphs(content: El[] | undefined, inTable = false): Para[] {
  const out: Para[] = [];
  for (const el of content ?? []) {
    if (el.paragraph) {
      out.push({
        start: el.startIndex ?? 0,
        end: el.endIndex ?? 0,
        text: (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? "").join(""),
        style: el.paragraph.paragraphStyle?.namedStyleType ?? null,
        inTable,
      });
    } else if (el.table) {
      for (const row of el.table.tableRows ?? [])
        for (const cell of row.tableCells ?? []) out.push(...paragraphs(cell.content, true));
    } else if (el.tableOfContents) {
      out.push(...paragraphs(el.tableOfContents.content, inTable));
    }
  }
  return out;
}

export async function getDoc(docId: string) {
  const { docs } = gapi();
  const res = await docs.documents.get({ documentId: docId });
  return res.data;
}

export function docPlainText(doc: docs_v1.Schema$Document): string {
  return paragraphs(doc.body?.content).map((p) => p.text).join("");
}

export async function batch(docId: string, requests: docs_v1.Schema$Request[]) {
  if (!requests.length) return;
  const { docs } = gapi();
  // The API caps a batch; chunking keeps big documents safe. Each chunk is
  // applied in order, so index math done for the whole list still holds.
  // Docs allows 60 writes per minute per user: retry quota errors with backoff.
  for (let i = 0; i < requests.length; i += 400) {
    const chunk = requests.slice(i, i + 400);
    for (let attempt = 0; ; attempt++) {
      try {
        await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: chunk } });
        break;
      } catch (e) {
        const err = e as { code?: number; message?: string };
        if (!(err?.code === 429 || /quota/i.test(err?.message ?? "")) || attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, Math.min(30000, 4000 * 2 ** attempt)));
      }
    }
  }
}

// Text positions of every occurrence of `needle` in the body (tables too).
export function findText(doc: docs_v1.Schema$Document, needle: string): { start: number; end: number }[] {
  const hits: { start: number; end: number }[] = [];
  const walk = (content: El[] | undefined) => {
    for (const el of content ?? []) {
      if (el.paragraph) {
        for (const pe of el.paragraph.elements ?? []) {
          const t = pe.textRun?.content;
          if (!t || pe.startIndex == null) continue;
          let at = t.indexOf(needle);
          while (at >= 0) {
            hits.push({ start: pe.startIndex + at, end: pe.startIndex + at + needle.length });
            at = t.indexOf(needle, at + needle.length);
          }
        }
      } else if (el.table) {
        for (const row of el.table.tableRows ?? []) for (const cell of row.tableCells ?? []) walk(cell.content);
      }
    }
  };
  walk(doc.body?.content);
  return hits;
}

export function leftovers(doc: docs_v1.Schema$Document): string[] {
  const text = docPlainText(doc);
  const found = new Set<string>();
  for (const m of Array.from(text.matchAll(/\{\{[^}]*\}\}|\[\[[^\]]*\]\]|\{\{|\[\[/g))) found.add(m[0]);
  return Array.from(found);
}

export type TableRows = { key: string; rows: string[][] };
export type DocPlan = {
  // Optional sections: [[BEGIN:x]] .. [[END:x]] kept when true, removed when false.
  sections: Record<string, boolean>;
  scalars: Record<string, string>;
  lists: Record<string, string[]>;
  tables: TableRows[];
  // Tokens wrapped in named ranges after replacing (deal_date_issued, ...).
  namedTokens: { token: string; rangeName: string; text: string }[];
  // Heading titles whose final section number fills a token:
  // e.g. { selection_section_number: /package selection/i }.
  sectionNumberTokens: Record<string, RegExp>;
};

// Fill a copied master. Steps, each from a fresh read of the Doc:
// 1. drop unsold sections (end of the doc backward), then the markers;
// 2. variable-row tables: copy the prototype row, then fill every cell;
// 3. renumber "N. Title" headings, note the numbers asked for;
// 4. list tokens (empty ones lose their paragraph), then replaceAllText;
// 5. named ranges for the date tokens.
export async function fillDocument(docId: string, plan: DocPlan): Promise<{ leftovers: string[] }> {
  // 1. Sections.
  let doc = await getDoc(docId);
  const paras = paragraphs(doc.body?.content);
  const del: { start: number; end: number }[] = [];
  const open = new Map<string, Para>();
  for (const p of paras) {
    const m = p.text.trim().match(/^\[\[(BEGIN|END):([a-z0-9_]+)\]\]$/i);
    if (!m) continue;
    const key = m[2].toLowerCase();
    if (m[1].toUpperCase() === "BEGIN") {
      open.set(key, p);
      continue;
    }
    const begin = open.get(key);
    if (!begin) continue;
    open.delete(key);
    if (plan.sections[key]) {
      del.push({ start: p.start, end: p.end }, { start: begin.start, end: begin.end });
    } else {
      del.push({ start: begin.start, end: p.end });
    }
  }
  // Nested ranges: a removed outer section swallows its inner markers.
  const ranges = mergeRanges(del);
  await batch(
    docId,
    ranges
      .sort((a, b) => b.start - a.start)
      .map((r) => ({ deleteContentRange: { range: { startIndex: r.start, endIndex: r.end } } }))
  );

  // 2. Tables.
  for (const t of plan.tables) {
    doc = await getDoc(docId);
    const found = findPrototypeRow(doc, `{{${t.key}.`);
    if (!found) continue;
    const { tableStart, rowIndex } = found;
    if (!t.rows.length) {
      await batch(docId, [
        { deleteTableRow: { tableCellLocation: { tableStartLocation: { index: tableStart }, rowIndex, columnIndex: 0 } } },
      ]);
      continue;
    }
    await batch(
      docId,
      Array.from({ length: t.rows.length - 1 }, () => ({
        insertTableRow: {
          tableCellLocation: { tableStartLocation: { index: tableStart }, rowIndex, columnIndex: 0 },
          insertBelow: true,
        },
      }))
    );
    doc = await getDoc(docId);
    const table = tableAt(doc, tableStart);
    if (!table) continue;
    const reqs: docs_v1.Schema$Request[] = [];
    const cells: { start: number; end: number; text: string }[] = [];
    t.rows.forEach((values, i) => {
      const row = table.tableRows?.[rowIndex + i];
      (row?.tableCells ?? []).forEach((cell, c) => {
        const content = cell.content ?? [];
        const start = content[0]?.startIndex ?? 0;
        const end = content[content.length - 1]?.endIndex ?? start + 1;
        cells.push({ start, end, text: values[c] ?? "" });
      });
    });
    for (const cell of cells.sort((a, b) => b.start - a.start)) {
      if (cell.end - 1 > cell.start)
        reqs.push({ deleteContentRange: { range: { startIndex: cell.start, endIndex: cell.end - 1 } } });
      if (cell.text) reqs.push({ insertText: { location: { index: cell.start }, text: cell.text } });
    }
    await batch(docId, reqs);
  }

  // 3. Renumber "N. Title" headings.
  doc = await getDoc(docId);
  const numbered = paragraphs(doc.body?.content).filter(
    (p) => !p.inTable && p.style?.startsWith("HEADING") && /^\d+\.\s/.test(p.text)
  );
  const renumber: { s: number; have: string; want: string }[] = [];
  const numbers: Record<string, string> = {};
  numbered.forEach((p, i) => {
    const want = String(i + 1);
    const have = p.text.match(/^(\d+)\./)![1];
    for (const [token, re] of Object.entries(plan.sectionNumberTokens)) if (re.test(p.text)) numbers[token] = want;
    if (have !== want) renumber.push({ s: p.start, have, want });
  });
  await batch(
    docId,
    renumber
      .sort((a, b) => b.s - a.s)
      .flatMap((r): docs_v1.Schema$Request[] => [
        { deleteContentRange: { range: { startIndex: r.s, endIndex: r.s + r.have.length } } },
        { insertText: { location: { index: r.s }, text: r.want } },
      ])
  );

  // 4. Tokens. Empty lists: remove the paragraph holding only the token.
  doc = await getDoc(docId);
  const emptyLists = Object.entries(plan.lists).filter(([, v]) => !v.length).map(([k]) => `{{${k}}}`);
  const dropParas = paragraphs(doc.body?.content).filter((p) => emptyLists.includes(p.text.trim()));
  await batch(
    docId,
    dropParas
      .sort((a, b) => b.start - a.start)
      .map((p) => ({ deleteContentRange: { range: { startIndex: p.start, endIndex: p.end } } }))
  );
  // [[EDIT: ...]] is the general pattern for anything the CRM can't fill: an
  // empty scalar, or a {{token}} in the master the plan doesn't know. Only
  // tokens still in the Doc matter (removed sections are already gone), and
  // the approval check refuses any "[[" left.
  const replace: Record<string, string> = {};
  for (const [k, v] of Object.entries(plan.scalars)) replace[k] = v.trim() ? v : `[[EDIT: ${k.replace(/_/g, " ")}]]`;
  for (const [k, v] of Object.entries(plan.lists)) if (v.length) replace[k] = v.join("\n");
  for (const [k, v] of Object.entries(numbers)) replace[k] = v;
  for (const t of plan.namedTokens) delete replace[t.token];
  const named = new Set(plan.namedTokens.map((t) => t.token));
  for (const m of Array.from(docPlainText(doc).matchAll(/\{\{([a-z0-9_.]+)\}\}/gi))) {
    const k = m[1];
    if (!(k in replace) && !named.has(k) && !(k in plan.lists)) replace[k] = `[[EDIT: ${k.replace(/_/g, " ")}]]`;
  }
  await batch(
    docId,
    Object.entries(replace).map(([k, v]) => ({
      replaceAllText: { containsText: { text: `{{${k}}}`, matchCase: true }, replaceText: v },
    }))
  );

  // 5. Named ranges for dates (replaced later by replaceNamedRangeContent).
  doc = await getDoc(docId);
  const hits = plan.namedTokens.flatMap((t) =>
    findText(doc, `{{${t.token}}}`).map((h) => ({ ...h, ...t }))
  );
  await batch(
    docId,
    hits
      .sort((a, b) => b.start - a.start)
      .flatMap((h) => [
        { deleteContentRange: { range: { startIndex: h.start, endIndex: h.end } } },
        { insertText: { location: { index: h.start }, text: h.text } },
        { createNamedRange: { name: h.rangeName, range: { startIndex: h.start, endIndex: h.start + h.text.length } } },
      ])
  );

  doc = await getDoc(docId);
  return { leftovers: leftovers(doc) };
}

function mergeRanges(r: { start: number; end: number }[]) {
  const sorted = [...r].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.start < last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

function tableAt(doc: docs_v1.Schema$Document, start: number): docs_v1.Schema$Table | null {
  for (const el of doc.body?.content ?? []) if (el.table && el.startIndex === start) return el.table;
  return null;
}

function findPrototypeRow(doc: docs_v1.Schema$Document, needle: string) {
  for (const el of doc.body?.content ?? []) {
    if (!el.table) continue;
    const rows = el.table.tableRows ?? [];
    for (let r = 0; r < rows.length; r++) {
      const text = (rows[r].tableCells ?? [])
        .map((c) => paragraphs(c.content).map((p) => p.text).join(""))
        .join("");
      if (text.includes(needle)) return { tableStart: el.startIndex ?? 0, rowIndex: r };
    }
  }
  return null;
}

// Approval: write the fresh dates into the named ranges.
export async function replaceDates(docId: string, values: Record<string, string>) {
  const doc = await getDoc(docId);
  const names = new Set(Object.keys(doc.namedRanges ?? {}));
  await batch(
    docId,
    Object.entries(values)
      .filter(([name]) => names.has(name))
      .map(([name, text]) => ({ replaceNamedRangeContent: { namedRangeName: name, text } }))
  );
}

// A plain Doc (internal deal doc): headings and lines. With existingId the
// Doc's body is replaced in place (same link); a trashed or missing Doc is
// created again.
export async function writePlainDoc(
  name: string,
  parentId: string,
  blocks: { heading?: string; lines: string[] }[],
  existingId?: string | null
): Promise<string> {
  const { drive } = gapi();
  let id = existingId ?? null;
  if (id) {
    try {
      const meta = await drive.files.get({ ...ALL, fileId: id, fields: "id, trashed" });
      if (meta.data.trashed) id = null;
    } catch {
      id = null;
    }
  }
  if (!id) {
    const created = await drive.files.create({
      ...ALL,
      requestBody: { name, parents: [parentId], mimeType: "application/vnd.google-apps.document" },
      fields: "id",
    });
    id = created.data.id!;
  } else {
    const doc = await getDoc(id);
    const end = doc.body?.content?.at(-1)?.endIndex ?? 1;
    if (end > 2) await batch(id, [{ deleteContentRange: { range: { startIndex: 1, endIndex: end - 1 } } }]);
    await batch(id, [
      {
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 2 },
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          fields: "namedStyleType",
        },
      },
    ]);
  }
  // Build the text, then style headings by range.
  let text = "";
  const headings: { start: number; end: number }[] = [];
  for (const b of blocks) {
    if (b.heading) {
      const s = 1 + text.length;
      text += b.heading + "\n";
      headings.push({ start: s, end: s + b.heading.length + 1 });
    }
    for (const l of b.lines) text += l + "\n";
    text += "\n";
  }
  await batch(id, [
    { insertText: { location: { index: 1 }, text } },
    ...headings.map((h) => ({
      updateParagraphStyle: {
        range: { startIndex: h.start, endIndex: h.end },
        paragraphStyle: { namedStyleType: "HEADING_2" },
        fields: "namedStyleType",
      },
    })),
  ]);
  return id;
}
