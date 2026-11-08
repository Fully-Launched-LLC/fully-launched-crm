"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { money, sortItems } from "@/lib/deals/money";
import {
  DEAL_BRANCHES,
  DEAL_BRANCH_NAMES,
  LINE_ITEM_KIND_LABELS,
  type DealBranch,
  type DealLineItem,
  type LineItemKind,
} from "@/lib/deals/types";

const cell = "w-full rounded border border-neutral-300 px-2 py-1 text-sm disabled:bg-neutral-50";
const small = "text-xs text-neutral-500";

// Line items grouped by branch. Amounts are typed by hand (no defaults).
// Every change on an approved / sent / viewed deal is confirmed first; the
// database then sends the deal back to draft.
export default function LineItemsEditor({
  dealId,
  items,
  locked,
  guard,
  defaultOverage,
  onChanged,
  onError,
}: {
  dealId: string;
  items: DealLineItem[];
  locked: boolean;
  guard: (run: () => void, cancel?: () => void) => void;
  defaultOverage: number;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [adding, setAdding] = useState<DealBranch | "">("");
  const [draft, setDraft] = useState({ label: "", kind: "one_time" as LineItemKind, amount: "", tier_name: "" });

  const grouped = DEAL_BRANCHES.map((b) => ({ branch: b, list: sortItems(items.filter((i) => i.branch === b)) })).filter(
    (g) => g.list.length
  );

  async function update(id: string, patch: Partial<DealLineItem>) {
    const { data, error } = await supabase.from("deal_line_items").update(patch).eq("id", id).select("id");
    if (error) onError(error.message);
    else if (!data?.length) onError("Not saved. Reload and try again.");
    onChanged();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("deal_line_items").delete().eq("id", id);
    if (error) onError(error.message);
    onChanged();
  }

  async function move(list: DealLineItem[], idx: number, dir: -1 | 1) {
    const other = list[idx + dir];
    if (!other) return;
    const a = list[idx];
    // Normalize the order, then swap the two.
    const order = list.map((x) => x.id);
    order.splice(idx, 1);
    order.splice(idx + dir, 0, a.id);
    for (let n = 0; n < order.length; n++) {
      const it = list.find((x) => x.id === order[n])!;
      if (it.sort_order !== n) await supabase.from("deal_line_items").update({ sort_order: n }).eq("id", it.id);
    }
    onChanged();
  }

  async function add(branch: DealBranch) {
    const amount = Number(draft.amount);
    if (!draft.label.trim() || draft.amount.trim() === "" || !Number.isFinite(amount) || amount < 0) {
      onError("Enter a label and an amount.");
      return;
    }
    const max = Math.max(-1, ...items.filter((i) => i.branch === branch).map((i) => i.sort_order));
    const { error } = await supabase.from("deal_line_items").insert({
      deal_id: dealId,
      branch,
      label: draft.label.trim(),
      kind: draft.kind,
      amount,
      tier_name: draft.tier_name.trim() || null,
      sort_order: max + 1,
    });
    if (error) onError(error.message);
    else {
      setDraft({ label: "", kind: "one_time", amount: "", tier_name: "" });
      setAdding("");
    }
    onChanged();
  }

  const text = (i: DealLineItem, key: "label" | "tier_name" | "description", placeholder?: string, area = false) => {
    const Tag = area ? "textarea" : "input";
    return (
      <Tag
        key={`${i.id}-${key}-${i[key] ?? ""}`}
        className={cell}
        defaultValue={i[key] ?? ""}
        placeholder={placeholder}
        disabled={locked}
        rows={area ? 2 : undefined}
        onBlur={(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          const v = e.target.value.trim();
          const value = key === "label" ? v : v || null;
          if ((value ?? "") === (i[key] ?? "")) return;
          if (key === "label" && !v) {
            e.target.value = i.label;
            return;
          }
          const el = e.target;
          guard(() => update(i.id, { [key]: value } as Partial<DealLineItem>), () => (el.value = i[key] ?? ""));
        }}
      />
    );
  };

  const num = (i: DealLineItem, key: "amount" | "hours_included" | "overage_rate", placeholder?: string) => (
    <input
      key={`${i.id}-${key}-${i[key] ?? ""}`}
      type="number"
      min={0}
      step="0.01"
      className={cell}
      defaultValue={i[key] ?? ""}
      placeholder={placeholder}
      disabled={locked}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (key === "amount" && raw === "") {
          e.target.value = String(i.amount);
          return;
        }
        const value = raw === "" ? null : Number(raw);
        if (value === (i[key] == null ? null : Number(i[key]))) return;
        const el = e.target;
        guard(() => update(i.id, { [key]: value } as Partial<DealLineItem>), () => (el.value = String(i[key] ?? "")));
      }}
    />
  );

  const flag = (i: DealLineItem, key: "optional" | "selected_by_default" | "is_productized_tool", lbl: string) => (
    <label className="flex items-center gap-1.5 text-xs text-neutral-700">
      <input
        type="checkbox"
        checked={i[key]}
        disabled={locked}
        onChange={(e) => {
          const v = e.target.checked;
          guard(() => update(i.id, { [key]: v } as Partial<DealLineItem>));
        }}
      />
      {lbl}
    </label>
  );

  return (
    <div className="rounded-lg border border-neutral-200 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Line items</h3>
        <span className={small}>Amounts are never sent to the AI. Every price in the documents comes from here.</span>
        {!locked && (
          <select
            className="ml-auto rounded border border-neutral-300 px-2 py-1.5 text-sm"
            value={adding}
            onChange={(e) => setAdding(e.target.value as DealBranch)}
          >
            <option value="">+ Add item to...</option>
            {DEAL_BRANCHES.map((b) => (
              <option key={b} value={b}>
                {DEAL_BRANCH_NAMES[b]}
              </option>
            ))}
          </select>
        )}
      </div>

      {adding && (
        <div className="mt-3 grid grid-cols-1 gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 sm:grid-cols-5">
          <input className={cell} placeholder="Label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <input
            className={cell}
            placeholder="Tier name (optional)"
            value={draft.tier_name}
            onChange={(e) => setDraft({ ...draft, tier_name: e.target.value })}
          />
          <select className={cell} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as LineItemKind })}>
            {(Object.keys(LINE_ITEM_KIND_LABELS) as LineItemKind[]).map((k) => (
              <option key={k} value={k}>
                {LINE_ITEM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <input
            className={cell}
            type="number"
            min={0}
            step="0.01"
            placeholder="Amount ($)"
            value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-header px-3 py-1.5 text-sm font-medium text-header-foreground"
              onClick={() => guard(() => add(adding as DealBranch))}
            >
              Add to {DEAL_BRANCH_NAMES[adding as DealBranch]}
            </button>
            <button type="button" className="text-sm text-neutral-500" onClick={() => setAdding("")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!grouped.length && <p className="mt-3 text-sm text-neutral-500">No line items yet.</p>}

      {grouped.map((g) => (
        <div key={g.branch} className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{DEAL_BRANCH_NAMES[g.branch]}</h4>
          <div className="mt-2 space-y-3">
            {g.list.map((i, idx) => (
              <div key={i.id} className="rounded-md border border-neutral-200 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-3">
                    <span className={small}>Label</span>
                    {text(i, "label")}
                  </div>
                  <div className="sm:col-span-2">
                    <span className={small}>Tier name</span>
                    {text(i, "tier_name", "None")}
                  </div>
                  <div className="sm:col-span-2">
                    <span className={small}>Kind</span>
                    <select
                      className={cell}
                      value={i.kind}
                      disabled={locked}
                      onChange={(e) => {
                        const v = e.target.value as LineItemKind;
                        guard(() => update(i.id, { kind: v }));
                      }}
                    >
                      {(Object.keys(LINE_ITEM_KIND_LABELS) as LineItemKind[]).map((k) => (
                        <option key={k} value={k}>
                          {LINE_ITEM_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <span className={small}>Amount ($)</span>
                    {num(i, "amount")}
                  </div>
                  <div className="sm:col-span-1">
                    <span className={small}>Hours incl.</span>
                    {num(i, "hours_included")}
                  </div>
                  <div className="sm:col-span-2">
                    <span className={small}>Overage ($/hr)</span>
                    {num(i, "overage_rate", money(defaultOverage))}
                  </div>
                  <div className="sm:col-span-12">
                    <span className={small}>Description (scope notes; prices here are hidden from the AI)</span>
                    {text(i, "description", "What's included", true)}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  {flag(i, "optional", "Optional")}
                  {flag(i, "selected_by_default", "Selected by default")}
                  {flag(i, "is_productized_tool", "Productized tool")}
                  {!locked && (
                    <div className="ml-auto flex gap-2 text-sm">
                      <button type="button" className="text-neutral-600 disabled:opacity-30" disabled={idx === 0} onClick={() => guard(() => move(g.list, idx, -1))}>
                        Up
                      </button>
                      <button
                        type="button"
                        className="text-neutral-600 disabled:opacity-30"
                        disabled={idx === g.list.length - 1}
                        onClick={() => guard(() => move(g.list, idx, 1))}
                      >
                        Down
                      </button>
                      <button type="button" className="text-red-600" onClick={() => guard(() => remove(i.id))}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
