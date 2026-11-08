/*
 * Replacement map for scripts/build-doc-templates.ts --write (approved
 * Nov 6). Turns copies of the two source Docs into the CRM masters.
 *
 * Each step is a function of the freshly read Doc that returns Docs API
 * requests; steps run in order, one batchUpdate each. Paragraphs are found
 * by their text (exact, or by prefix), so a step fails loudly if the
 * source changed.
 */
import type { docs_v1 } from "@googleapis/docs";

type Doc = docs_v1.Schema$Document;
type Req = docs_v1.Schema$Request;
type Step = (doc: Doc) => Req[];

type P = {
  start: number;
  end: number;
  text: string; // without the trailing newline
  bullet: boolean;
  container: string; // "body" or "t<start>r<row>c<col>"
  firstInContainer: boolean;
  lastInContainer: boolean;
  prevEnd: number | null;
};

type El = docs_v1.Schema$StructuralElement;

function collect(content: El[] | undefined, container: string, out: P[]) {
  const mine: P[] = [];
  for (const el of content ?? []) {
    if (el.paragraph) {
      mine.push({
        start: el.startIndex ?? 0,
        end: el.endIndex ?? 0,
        text: (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? "").join("").replace(/\n$/, ""),
        bullet: !!el.paragraph.bullet,
        container,
        firstInContainer: false,
        lastInContainer: false,
        prevEnd: null,
      });
    } else if (el.table) {
      (el.table.tableRows ?? []).forEach((row, r) =>
        (row.tableCells ?? []).forEach((cell, c) => collect(cell.content, `t${el.startIndex}r${r}c${c}`, out))
      );
    }
  }
  mine.forEach((p, i) => {
    p.firstInContainer = i === 0;
    p.lastInContainer = i === mine.length - 1;
    p.prevEnd = i > 0 ? mine[i - 1].end : null;
  });
  out.push(...mine);
}

function paras(doc: Doc): P[] {
  const out: P[] = [];
  collect(doc.body?.content, "body", out);
  return out.sort((a, b) => a.start - b.start);
}

type Match = string | { starts: string };
const show = (m: Match) => (typeof m === "string" ? JSON.stringify(m) : `starts with ${JSON.stringify(m.starts)}`);
const hit = (p: P, m: Match) => (typeof m === "string" ? p.text === m : p.text.startsWith(m.starts));

function one(doc: Doc, m: Match): P {
  const found = paras(doc).filter((p) => hit(p, m));
  if (found.length !== 1) throw new Error(`map: expected one paragraph ${show(m)}, found ${found.length}`);
  return found[0];
}

function tables(doc: Doc) {
  return (doc.body?.content ?? []).filter((e) => e.table);
}

// ---- operations ----------------------------------------------------------------

const setTextReq = (p: P, text: string): Req[] => [
  ...(p.end - 1 > p.start ? [{ deleteContentRange: { range: { startIndex: p.start, endIndex: p.end - 1 } } }] : []),
  ...(text ? [{ insertText: { location: { index: p.start }, text } }] : []),
];

const setText = (m: Match, text: string): Step => (doc) => setTextReq(one(doc, m), text);

// Paragraph-by-paragraph replacement when the shapes match.
const setPairs = (pairs: [Match, string][]): Step[] => pairs.map(([m, t]) => setText(m, t));

function deleteReq(p: P): Req[] {
  if (p.lastInContainer) {
    // The last paragraph of a cell / the body can't lose its newline: merge it
    // into the previous one instead.
    if (p.prevEnd == null) return setTextReq(p, "");
    return [{ deleteContentRange: { range: { startIndex: p.prevEnd - 1, endIndex: p.end - 1 } } }];
  }
  return [{ deleteContentRange: { range: { startIndex: p.start, endIndex: p.end } } }];
}

const del = (m: Match): Step => (doc) => deleteReq(one(doc, m));

const delAll = (pred: (p: P) => boolean): Step => (doc) =>
  paras(doc)
    .filter(pred)
    .sort((a, b) => b.start - a.start)
    .flatMap(deleteReq);

type NewPara = { text: string; style?: "NORMAL_TEXT" | "HEADING_1" | "HEADING_2"; bullet?: boolean };

function styleReqs(ranges: { start: number; end: number; p: NewPara }[]): Req[] {
  return ranges.flatMap(({ start, end, p }) => [
    {
      updateParagraphStyle: {
        range: { startIndex: start, endIndex: end },
        paragraphStyle: { namedStyleType: p.style ?? "NORMAL_TEXT" },
        fields: "namedStyleType",
      },
    },
    p.bullet
      ? { createParagraphBullets: { range: { startIndex: start, endIndex: end }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } }
      : { deleteParagraphBullets: { range: { startIndex: start, endIndex: end } } },
  ]);
}

function layout(first: number, list: NewPara[]) {
  let at = first;
  return list.map((p) => {
    const r = { start: at, end: at + p.text.length + 1, p };
    at = r.end;
    return r;
  });
}

const insertBefore = (m: Match, list: NewPara[]): Step => (doc) => {
  const p = one(doc, m);
  return [
    { insertText: { location: { index: p.start }, text: list.map((x) => x.text).join("\n") + "\n" } },
    ...styleReqs(layout(p.start, list)),
  ];
};

const insertAfter = (m: Match, list: NewPara[]): Step => (doc) => {
  const p = one(doc, m);
  const i = p.end - 1;
  return [
    { insertText: { location: { index: i }, text: "\n" + list.map((x) => x.text).join("\n") } },
    ...styleReqs(layout(i + 1, list)),
  ];
};

// Replace one paragraph with several (styles set explicitly).
const replaceWith = (m: Match, list: NewPara[]): Step[] => [insertAfter(m, list), del(m)];

const setCell = (table: number, row: number, col: number, text: string): Step => (doc) => {
  const t = tables(doc)[table];
  if (!t?.table) throw new Error(`map: table ${table} not found`);
  const cell = t.table.tableRows?.[row]?.tableCells?.[col];
  if (!cell) throw new Error(`map: table ${table} r${row} c${col} not found`);
  const content = cell.content ?? [];
  const start = content[0]?.startIndex ?? 0;
  const end = content[content.length - 1]?.endIndex ?? start + 1;
  return [
    ...(end - 1 > start ? [{ deleteContentRange: { range: { startIndex: start, endIndex: end - 1 } } }] : []),
    ...(text ? [{ insertText: { location: { index: start }, text } }] : []),
  ];
};

const deleteRows = (table: number, rows: number[]): Step => (doc) => {
  const t = tables(doc)[table];
  if (!t) throw new Error(`map: table ${table} not found`);
  return [...rows]
    .sort((a, b) => b - a)
    .map((rowIndex) => ({
      deleteTableRow: { tableCellLocation: { tableStartLocation: { index: t.startIndex! }, rowIndex, columnIndex: 0 } },
    }));
};

const replaceAll = (pairs: [string, string][]): Step => () =>
  pairs.map(([a, b]) => ({ replaceAllText: { containsText: { text: a, matchCase: true }, replaceText: b } }));

const report: Step = (doc) => {
  const text = paras(doc).map((p) => p.text).join("\n");
  const left = Array.from(new Set(Array.from(text.matchAll(/\[(?!\[)[^\]\n]{1,80}\](?!\])/g)).map((m) => m[0])));
  if (left.length) console.log(`  Bracketed text still in the master (check by hand): ${left.join(", ")}`);
  if (/TEMPLATE NOTE/.test(text)) console.log("  A TEMPLATE NOTE is still in the master.");
  return [];
};

// ---- boilerplate.md ------------------------------------------------------------

function parseBoilerplate(md: string): Record<string, { text: string; bullet: boolean }[]> {
  const out: Record<string, { text: string; bullet: boolean }[]> = {};
  let key: string | null = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^## ([a-z0-9_]+)\s*$/);
    if (h) {
      key = h[1];
      out[key] = [];
      continue;
    }
    if (!key || line.startsWith("<!--") || !line.trim()) continue;
    out[key].push(line.startsWith("- ") ? { text: line.slice(2), bullet: true } : { text: line, bullet: false });
  }
  return out;
}

const marker = (s: string): NewPara => ({ text: s });

// ---- the maps ---------------------------------------------------------------------

export function buildRequests(kind: "sow" | "proposal", boilerplateMd: string): Step[] {
  const bp = parseBoilerplate(boilerplateMd);
  const B = (k: string) => {
    if (!bp[k]?.length) throw new Error(`boilerplate.md: missing ${k}`);
    return bp[k];
  };
  const joined = (k: string) => B(k).map((x) => x.text).join("\n");
  const asParas = (k: string): NewPara[] => B(k).map((x) => ({ text: x.text, bullet: x.bullet }));

  if (kind === "proposal") return proposalSteps();

  const pairsFrom = (matches: Match[], k: string): Step[] => {
    const lines = B(k);
    if (lines.length !== matches.length) throw new Error(`map: ${k} has ${lines.length} lines, expected ${matches.length}`);
    return setPairs(matches.map((m, i) => [m, lines[i].text]));
  };

  return [
    // Notes and placeholders that go away.
    delAll((p) => p.text.startsWith("TEMPLATE NOTE:")),

    // Cover, header table, supersedes.
    setText("Fully Launched × [CLIENT NAME]", "Fully Launched × {{client_name}}"),
    setText("[CLIENT / BUSINESS NAME]", "{{client_name}}"),
    setText("[DATE ISSUED]", "{{date_issued}}"),
    setText("[DATE — typically 2 weeks out]", "{{valid_through}}"),
    setCell(0, 4, 1, "{{target_launch}}"),
    setText({ starts: "This Statement of Work is entered into between" }, joined("supersedes_clause")),

    // 1. Overview.
    ...replaceWith({ starts: "Fully Launched will manage [CLIENT NAME]" }, [
      marker("[[BEGIN:overview_multi]]"),
      { text: joined("overview_multi") },
      marker("[[END:overview_multi]]"),
      marker("[[BEGIN:overview_single]]"),
      { text: joined("overview_single") },
      marker("[[END:overview_single]]"),
    ]),
    setText({ starts: "[ONE TO TWO SENTENCES ON THE CLIENT" }, "{{brand_sentence}}"),

    // 2. Website.
    insertBefore("2. Section A — Website Design & Development", [marker("[[BEGIN:website]]")]),
    setText("2. Section A — Website Design & Development", "2. Website Design & Development"),
    ...replaceWith({ starts: "[CLIENT NAME] selects one of the tiers below." }, [
      { text: "{{website_intro}}" },
      { text: "{{website_tiers}}", bullet: true },
      { text: "Deliverables", style: "HEADING_2" },
      { text: "{{website_deliverables}}", bullet: true },
    ]),
    delAll((p) =>
      ["Tier 1 — [Name] — $[X,XXX]", "Tier 2 — [Name] — $[X,XXX]", "[Deliverable]", "Everything included in Tier 1, plus:"].includes(
        p.text
      )
    ),
    insertBefore("Ongoing Maintenance (optional)", [marker("[[BEGIN:website_maintenance]]")]),
    setText({ starts: "Monthly maintenance fee: $[XXX]" }, joined("website_maintenance")),
    insertAfter({ starts: "Monthly maintenance fee: {{maintenance_amount}}" }, [marker("[[END:website_maintenance]]")]),
    setText("Section A Exclusions", "Website Exclusions"),
    setText({ starts: "[What's NOT included" }, joined("exclusions_website")),
    del({ starts: "[e.g., domain registration" }),
    insertAfter(B("exclusions_website").slice(-1)[0].text, [marker("[[END:website]]")]),

    // 3. Marketplace.
    insertBefore("3. Section B — Marketplace", [marker("[[BEGIN:marketplace]]")]),
    setText("3. Section B — Marketplace", "3. Marketplace"),
    setText("Marketplace Build — $[X,XXX]", "{{marketplace_intro}}"),
    ...replaceWith({ starts: "[Describe hours included, overage rate" }, [
      { text: "{{marketplace_items}}", bullet: true },
      { text: "Deliverables", style: "HEADING_2" },
      { text: "{{marketplace_deliverables}}", bullet: true },
    ]),
    insertBefore("Post-Launch Optimization", [marker("[[BEGIN:marketplace_retainer]]")]),
    setText({ starts: "[X weeks/months] of included optimization" }, joined("marketplace_post_launch")),
    insertAfter({ starts: "{{optimization_period}} of included optimization" }, [marker("[[END:marketplace_retainer]]")]),
    setText("Section B Exclusions", "Marketplace Exclusions"),
    ...pairsFrom([{ starts: "[e.g., additional marketplaces" }, { starts: "[e.g., platform seller fees" }], "exclusions_marketplace"),
    insertAfter(B("exclusions_marketplace").slice(-1)[0].text, [marker("[[END:marketplace]]")]),

    // 4. Social.
    insertBefore("4. Section C — Social Media Management", [marker("[[BEGIN:social]]")]),
    setText("4. Section C — Social Media Management", "4. Social Media Management"),
    setText("[Price] — $[X,XXX] per month", "{{social_intro}}"),
    setText({ starts: "[X] posts per week" }, "{{social_items}}"),
    setText({ starts: "Content mix: [X] camera-produced" }, "{{social_deliverables}}"),
    delAll(
      (p) =>
        p.text.startsWith("[Production day cadence") ||
        p.text === "Publishing and scheduling to [PLATFORMS]" ||
        p.text.startsWith("[Revision policy") ||
        p.text.startsWith("[Reporting cadence")
    ),
    insertBefore("Travel Terms (if on-site production is included)", [marker("[[BEGIN:social_travel]]")]),
    setText("Travel Terms (if on-site production is included)", "Travel Terms"),
    ...pairsFrom(
      [
        { starts: "Travel is not included in the monthly fee" },
        { starts: "Mileage, reimbursed" },
        { starts: "Lodging, where" },
        { starts: "Meals and incidentals" },
      ],
      "social_travel_terms"
    ),
    insertAfter(B("social_travel_terms").slice(-1)[0].text, [marker("[[END:social_travel]]")]),
    insertBefore("Production Day Terms (if applicable)", [marker("[[BEGIN:social_production]]")]),
    setText("Production Day Terms (if applicable)", "Production Day Terms"),
    ...pairsFrom(
      [
        { starts: "Production days are scheduled with a minimum of [X]" },
        { starts: "[CLIENT NAME] provides the location" },
        { starts: "Fully Launched supplies the shot list in advance. Plan for [X" },
        { starts: "A production day cancelled within [48]" },
        { starts: "Additional production days beyond those included" },
      ],
      "social_production_day_terms"
    ),
    insertAfter(B("social_production_day_terms").slice(-1)[0].text, [marker("[[END:social_production]]")]),
    setText("Section C Exclusions", "Social Media Exclusions"),
    ...pairsFrom([{ starts: "Community management (responses" }, { starts: "[Stories, paid advertising" }], "exclusions_social"),

    // 5. AI Tool Build and 6. Other Services (new), after Social.
    insertAfter(B("exclusions_social").slice(-1)[0].text, [
      marker("[[END:social]]"),
      marker("[[BEGIN:ai_tool]]"),
      { text: "5. AI Tool Build", style: "HEADING_1" },
      { text: "{{ai_tool_intro}}" },
      { text: "{{ai_tool_items}}", bullet: true },
      { text: "Phases", style: "HEADING_2" },
      { text: "{{ai_tool_phases}}", bullet: true },
      { text: "Deliverables", style: "HEADING_2" },
      { text: "{{ai_tool_deliverables}}", bullet: true },
      { text: "AI Tool Build Exclusions", style: "HEADING_2" },
      ...asParas("exclusions_ai_tool"),
      marker("[[END:ai_tool]]"),
      marker("[[BEGIN:other]]"),
      { text: "6. Other Services", style: "HEADING_1" },
      { text: "{{other_intro}}" },
      { text: "{{other_items}}", bullet: true },
      { text: "{{other_deliverables}}", bullet: true },
      marker("[[END:other]]"),
    ]),

    // Renumber the fixed sections after the two new ones.
    ...setPairs([
      ["5. Timeline & Milestones", "7. Timeline & Milestones"],
      ["6. Client Responsibilities & Dependencies", "8. Client Responsibilities & Dependencies"],
      ["7. Ownership, Access & Reporting", "9. Ownership, Access & Reporting"],
      ["8. Change Requests & Out-of-Scope Work", "10. Change Requests & Out-of-Scope Work"],
      ["9. Fees & Payment Terms", "11. Fees & Payment Terms"],
      ["10. Term & Termination", "12. Term & Termination"],
      ["11. Package Selection", "13. Package Selection"],
      ["12. Acceptance & Signatures", "14. Acceptance & Signatures"],
    ]),

    // 7. Timeline.
    setText({ starts: "[Target launch/start date]. This date is contingent" }, joined("timeline_intro")),
    setCell(1, 1, 1, "At signature"),
    setCell(1, 1, 2, joined("timeline_gate_row")),
    setCell(1, 2, 1, "{{week1_dates}}"),
    setCell(1, 2, 2, joined("timeline_week1_row")),
    setCell(1, 3, 0, "{{timeline.period}}"),
    setCell(1, 3, 1, "{{timeline.dates}}"),
    setCell(1, 3, 2, "{{timeline.milestone}}"),
    setCell(1, 4, 1, "{{target_launch}}"),
    setCell(1, 4, 2, "Launch and handoff."),

    // 8. Dependencies.
    setText({ starts: "The timeline above assumes" }, joined("dependencies_intro")),
    setCell(2, 1, 0, "{{dependencies.dependency}}"),
    setCell(2, 1, 1, "{{dependencies.detail}}"),
    deleteRows(2, [2, 3, 4]),
    setText({ starts: "[CLIENT NAME] will designate a point of contact" }, joined("dependencies_contact")),

    // 9. Ownership, reporting, support.
    ...pairsFrom(
      [
        { starts: "[CLIENT NAME] owns 100% of the" },
        { starts: "[CLIENT NAME] retains administrator access" },
        { starts: "Should the engagement end" },
      ],
      "ownership"
    ),
    setText({ starts: "Fully Launched provides written reports on a" }, joined("reporting")),
    ...pairsFrom([{ starts: "[Response time] response" }, { starts: "Resolution times vary" }], "support"),

    // 10. Change requests.
    setText({ starts: "Work outside the scope defined in this SOW" }, joined("change_requests_intro")),
    setCell(3, 1, 0, "{{change_requests.service}}"),
    setCell(3, 1, 1, "{{change_requests.rate}}"),
    setCell(3, 1, 2, "{{change_requests.approval}}"),
    deleteRows(3, [2]),

    // 11. Fees.
    setText({ starts: "[Service] is billed at" }, "{{fees_items}}"),
    setText({ starts: "[Payment schedule" }, joined("fees_terms")),
    del({ starts: "Payment terms: [Net 15" }),
    del({ starts: "[Third-party costs not included" }),
    setText({ starts: "Work does not begin until the executed SOW and [deposit" }, joined("fees_gate")),
    insertBefore({ starts: "Work does not begin until the executed SOW and {{first_payment}}" }, [
      { text: "Assumptions Used in Pricing", style: "HEADING_2" },
      { text: "{{assumptions}}" },
    ]),

    // 12. Term.
    ...pairsFrom(
      [
        { starts: "[Minimum term, if any" },
        "There are no termination fees",
        { starts: "[What happens on cancellation" },
        { starts: "All logins, assets, and documentation are transferred to [CLIENT NAME]" },
      ],
      "term_termination"
    ),

    // 13. Package selection.
    insertBefore("13. Package Selection", [marker("[[BEGIN:package_selection]]")]),
    setText({ starts: "[CLIENT NAME] indicates its selections below" }, joined("package_selection_intro")),
    setText({ starts: "Section A — [Website]:" }, "{{package_selection_items}}"),
    del({ starts: "Section B — [Marketplace]:" }),
    del({ starts: "Section C — [Social Media]:" }),
    insertAfter("{{package_selection_items}}", [
      { text: "Selections are recorded at electronic signature on the Selections page of the signed copy." },
      marker("[[END:package_selection]]"),
    ]),

    // 14. Acceptance.
    setText({ starts: "By signing below, both parties agree" }, joined("acceptance")),
    setText("[CLIENT NAME]", "{{client_name}}"),

    // Page header, any [CLIENT NAME] left in running text.
    replaceAll([
      ["FULLY LAUNCHED — STATEMENT OF WORK TEMPLATE", "FULLY LAUNCHED: STATEMENT OF WORK"],
      ["[CLIENT NAME]", "{{client_name}}"],
    ]),
    report,
  ];

  function proposalSteps(): Step[] {
    return [
      setText("            x Air-Rite", "            x {{client_name}}"),
      setText({ starts: "Project Goal: Build a custom AI-powered tool" }, "Project Goal: {{project_goal}}"),
      del({ starts: "Fully Launched builds custom AI software for businesses." }),
      setText({ starts: "For Air-Rite, we're building a tool" }, "{{overview}}"),
      // Project Scope: four phase blocks in the first paragraph, the rest removed.
      setText(
        "Phase 1: Discovery & Access Setup",
        [1, 2, 3, 4].map((n) => `Phase ${n}: {{phase_${n}_name}}\n{{phase_${n}}}`).join("\n\n")
      ),
      del({ starts: "- Review current invoice-to-PO workflow" }),
      del({ starts: "- Confirm system API access" }),
      trimScopeCellTail,
      // Expected outcomes.
      setText({ starts: "A working tool that turns invoice upload" }, "{{expected_outcomes}}"),
      del("Significant reduction in manual data entry time"),
      // Timeline.
      setText({ starts: "Estimated: 3-4 weeks" }, "Estimated: {{timeline_estimate}}"),
      setText("Weekly check-ins during the build.", "{{meeting_cadence}}"),
      del({ starts: "At Phase 3, more regular daily checkins" }),
      // Investment (built by code).
      setText({ starts: "Initial Build: $8,000" }, "{{investment}}"),
      del({ starts: "50% deposit due before Phase 1" }),
      del("Safety Net: +$100/hr over 50 hours"),
      del({ starts: "\u000bOngoing Retainer: $400/month" }),
      // The empty sixth row.
      deleteRows(0, [5]),
      report,
    ];
  }

}

// The empty paragraphs after the phase block in the Project Scope cell
// (table 0, row 1, column 1): one delete from the end of the last
// non-empty paragraph to just before the cell's final newline.
const trimScopeCellTail: Step = (doc) => {
  const t = tables(doc)[0];
  if (!t) throw new Error("map: proposal table not found");
  const container = `t${t.startIndex}r1c1`;
  const cell = paras(doc).filter((p) => p.container === container);
  let lastText = cell.length - 1;
  while (lastText >= 0 && cell[lastText].text.trim() === "") lastText--;
  if (lastText < 0 || lastText === cell.length - 1) return [];
  const from = cell[lastText].end - 1;
  const to = cell[cell.length - 1].end - 1;
  return to > from ? [{ deleteContentRange: { range: { startIndex: from, endIndex: to } } }] : [];
};
