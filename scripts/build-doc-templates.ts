/*
 * Builds the two CRM master templates in the Shared Drive Templates folder:
 *   "CRM Master SOW"      from Fully_Launched_SOW_Template
 *   "CRM Master Proposal" from Air-Rite PO Generator Proposal
 *
 * Usage (from the repo root; reads .env.local):
 *   npx tsx scripts/build-doc-templates.ts --dump    read-only: writes the
 *       sources' structure to scripts/doc-templates/source-dump/*.txt
 *   npx tsx scripts/build-doc-templates.ts --write   copies the sources and
 *       applies scripts/doc-templates/map.ts, prints the new doc IDs + links
 *
 * Sources are looked up by ID first, then by exact name in
 * GOOGLE_DRIVE_TEMPLATES_FOLDER_ID. Run --write once; after that the masters
 * are edited in Google Docs.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { docs as docsApi, type docs_v1 } from "@googleapis/docs";
import { drive as driveApi } from "@googleapis/drive";
import { JWT } from "google-auth-library";

// ---- env -------------------------------------------------------------------
function loadEnv() {
  const file = path.resolve(".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

export const SOURCES = {
  sow: { id: "1TzB9sNCx0HTUGuT5k-Sav8PFCl_03ts6MFBefqs7iu0", name: "Fully_Launched_SOW_Template", master: "CRM Master SOW" },
  proposal: {
    id: "1jlgcrUGNU8y5HmrZ70tmj_O9eDhyMSrgzsMna_RRL5E",
    name: "Air-Rite PO Generator Proposal",
    master: "CRM Master Proposal",
  },
} as const;

function clients() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_B64 is not set (.env.local)");
  const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/documents"],
  });
  return { drive: driveApi({ version: "v3", auth }), docs: docsApi({ version: "v1", auth }), email: creds.client_email as string };
}

type Clients = ReturnType<typeof clients>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isQuota = (e: unknown) => {
  const err = e as { code?: number; status?: number; message?: string };
  return err?.code === 429 || err?.status === 429 || /quota/i.test(err?.message ?? "");
};

// Docs allows 60 write requests per minute per user: pace writes ~1.1 s
// apart and retry quota errors with backoff (up to ~2 minutes).
let lastWrite = 0;
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastWrite + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastWrite = Date.now();
    try {
      return await fn();
    } catch (e) {
      if (!isQuota(e) || attempt >= 6) throw e;
      const backoff = Math.min(60000, 5000 * 2 ** attempt);
      console.log(`  quota hit, waiting ${backoff / 1000}s...`);
      await sleep(backoff);
    }
  }
}

async function findSource(c: Clients, s: { id: string; name: string }): Promise<{ id: string; via: string }> {
  try {
    const r = await c.drive.files.get({ fileId: s.id, supportsAllDrives: true, fields: "id, name" });
    if (r.data.id) return { id: r.data.id, via: `id (${r.data.name})` };
  } catch {
    /* fall back to name */
  }
  const folder = process.env.GOOGLE_DRIVE_TEMPLATES_FOLDER_ID;
  if (!folder) throw new Error(`${s.name}: not readable by ID and GOOGLE_DRIVE_TEMPLATES_FOLDER_ID is not set`);
  const r = await c.drive.files.list({
    q: `'${folder}' in parents and name = '${s.name.replace(/'/g, "\\'")}' and trashed = false`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
    fields: "files(id, name, mimeType)",
  });
  const files = r.data.files ?? [];
  if (files.length !== 1)
    throw new Error(`${s.name}: expected exactly one file by that name in the Templates folder, found ${files.length}`);
  if (files[0].mimeType !== "application/vnd.google-apps.document")
    throw new Error(`${s.name} is ${files[0].mimeType}, not a Google Doc (open it in Docs and Save as Google Docs)`);
  return { id: files[0].id!, via: "name in Templates folder" };
}

// ---- dump --------------------------------------------------------------------
type El = docs_v1.Schema$StructuralElement;

function dumpContent(content: El[] | undefined, depth: string, out: string[]) {
  for (const el of content ?? []) {
    if (el.paragraph) {
      const text = (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? "").join("").replace(/\n$/, "");
      const style = el.paragraph.paragraphStyle?.namedStyleType ?? "";
      const bullet = el.paragraph.bullet ? ` bullet(${el.paragraph.bullet.nestingLevel ?? 0})` : "";
      out.push(`${depth}[${el.startIndex}-${el.endIndex}] P ${style}${bullet}: ${JSON.stringify(text)}`);
    } else if (el.table) {
      out.push(`${depth}[${el.startIndex}-${el.endIndex}] TABLE ${el.table.rows}x${el.table.columns}`);
      (el.table.tableRows ?? []).forEach((row, r) =>
        (row.tableCells ?? []).forEach((cell, c) => {
          out.push(`${depth}  cell r${r} c${c}:`);
          dumpContent(cell.content, depth + "    ", out);
        })
      );
    } else if (el.sectionBreak) {
      out.push(`${depth}[${el.startIndex ?? 0}-${el.endIndex}] SECTION_BREAK`);
    }
  }
}

async function dump() {
  const c = clients();
  console.log(`Service account: ${c.email}`);
  const dir = path.resolve("scripts/doc-templates/source-dump");
  mkdirSync(dir, { recursive: true });
  for (const [key, s] of Object.entries(SOURCES)) {
    const src = await findSource(c, s);
    const doc = (await c.docs.documents.get({ documentId: src.id })).data;
    const out: string[] = [`# ${s.name} (${src.id}, found by ${src.via})`, `# title: ${doc.title}`];
    for (const [hid, h] of Object.entries(doc.headers ?? {})) {
      out.push(`## HEADER ${hid}`);
      dumpContent(h.content, "", out);
    }
    out.push("## BODY");
    dumpContent(doc.body?.content, "", out);
    for (const [fid, f] of Object.entries(doc.footers ?? {})) {
      out.push(`## FOOTER ${fid}`);
      dumpContent(f.content, "", out);
    }
    out.push(`## INLINE OBJECTS: ${Object.keys(doc.inlineObjects ?? {}).length}, POSITIONED: ${Object.keys(doc.positionedObjects ?? {}).length}`);
    const file = path.join(dir, `${key}.txt`);
    writeFileSync(file, out.join("\n") + "\n");
    console.log(`${s.name}: ${src.via} -> ${file} (${out.length} lines)`);
  }
}

// ---- write -------------------------------------------------------------------
async function write() {
  const { buildRequests } = await import("./doc-templates/map");
  const c = clients();
  const folder = process.env.GOOGLE_DRIVE_TEMPLATES_FOLDER_ID;
  if (!folder) throw new Error("GOOGLE_DRIVE_TEMPLATES_FOLDER_ID is not set");
  const boilerplate = readFileSync(path.resolve("scripts/doc-templates/boilerplate.md"), "utf8");
  for (const [key, s] of Object.entries(SOURCES) as [keyof typeof SOURCES, (typeof SOURCES)[keyof typeof SOURCES]][]) {
    const existing = await c.drive.files.list({
      q: `'${folder}' in parents and name = '${s.master}' and trashed = false`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
      fields: "files(id)",
    });
    if (existing.data.files?.length) {
      console.log(`${s.master} already exists (${existing.data.files[0].id}); skipping. Delete it first to rebuild.`);
      continue;
    }
    const src = await findSource(c, s);
    const copy = await c.drive.files.copy({
      fileId: src.id,
      supportsAllDrives: true,
      requestBody: { name: s.master, parents: [folder] },
      fields: "id",
    });
    const id = copy.data.id!;
    // Each step reads the doc fresh and returns requests; applied in order.
    // On any failure the half-built copy is trashed so a rerun starts clean.
    try {
      const steps = buildRequests(key, boilerplate);
      for (let n = 0; n < steps.length; n++) {
        const doc = (await c.docs.documents.get({ documentId: id })).data;
        let requests: docs_v1.Schema$Request[];
        try {
          requests = steps[n](doc);
        } catch (e) {
          throw new Error(`step ${n + 1}: ${e instanceof Error ? e.message : e}`);
        }
        for (let i = 0; i < requests.length; i += 400) {
          const chunk = requests.slice(i, i + 400);
          await paced(() => c.docs.documents.batchUpdate({ documentId: id, requestBody: { requests: chunk } }));
        }
        if ((n + 1) % 20 === 0) console.log(`  ${s.master}: ${n + 1}/${steps.length} steps`);
      }
    } catch (e) {
      await c.drive.files.update({ fileId: id, supportsAllDrives: true, requestBody: { trashed: true } });
      throw new Error(`${s.master}: ${e instanceof Error ? e.message : e} (the partial copy was moved to trash)`);
    }
    console.log(`${s.master}: ${id}\n  https://docs.google.com/document/d/${id}/edit`);
  }
  console.log("\nSet GOOGLE_DOCS_SOW_TEMPLATE_ID and GOOGLE_DOCS_PROPOSAL_TEMPLATE_ID to the IDs above (.env.local and Vercel).");
}

const mode = process.argv[2];
(mode === "--dump" ? dump() : mode === "--write" ? write() : Promise.reject(new Error("Pass --dump or --write")))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
