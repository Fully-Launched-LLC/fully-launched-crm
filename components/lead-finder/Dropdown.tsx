"use client";

import { useEffect, useId, useRef, useState } from "react";

// Matteo's custom dropdown (enhanceSelect in his index.html) as a React
// component: gold chevron, optional type-to-filter, arrow keys / Enter /
// Escape, type-ahead on short lists, flips up near the bottom of the window.
// Styles: .dd* in lead-finder.css.

export type DropdownOption = { value: string; label: string };

const CHEV = (
  <svg aria-hidden="true" width="12" height="8" viewBox="0 0 12 8">
    <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function Dropdown({
  value,
  options,
  onChange,
  label,
  placeholder = "Choose",
  filter = false,
  id,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  filter?: boolean;
  id?: string;
}) {
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const typed = useRef({ text: "", timer: 0 as unknown as ReturnType<typeof setTimeout> });

  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  function openList(initialFilter = "") {
    const r = wrap.current?.getBoundingClientRect();
    setUp(!!r && window.innerHeight - r.bottom < 300 && r.top > 320);
    setQ(initialFilter);
    setActive(initialFilter ? 0 : Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
    if (filter) setTimeout(() => filterRef.current?.focus(), 0);
  }

  function close(focusBtn: boolean) {
    setOpen(false);
    if (focusBtn) btn.current?.focus();
  }

  function choose(i: number) {
    const o = shown[i];
    if (!o) return;
    onChange(o.value);
    close(true);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openList();
      if (!shown.length) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + d + shown.length) % shown.length);
    } else if (e.key === "Enter" || (e.key === " " && e.target === btn.current)) {
      e.preventDefault();
      if (!open) return openList();
      choose(active);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        close(true);
      }
    } else if (e.key === "Tab") {
      close(false);
    } else if (!filter && e.key.length === 1 && /\S/.test(e.key)) {
      const t = typed.current;
      t.text += e.key.toLowerCase();
      clearTimeout(t.timer);
      t.timer = setTimeout(() => (t.text = ""), 600);
      const idx = options.findIndex((o) => o.label.toLowerCase().startsWith(t.text));
      if (idx >= 0) {
        if (!open) openList();
        setActive(idx);
      }
    } else if (filter && !open && e.key.length === 1 && /\S/.test(e.key)) {
      e.preventDefault();
      openList(e.key);
    }
  }

  return (
    <div ref={wrap} className={`dd${open ? " open" : ""}${up ? " up" : ""}`}>
      <button
        ref={btn}
        id={id}
        type="button"
        className="dd-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${current ? current.label : "not chosen"}`}
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={onKey}
      >
        <span className={`val${current ? "" : " ph"}`}>{current ? current.label : placeholder}</span>
        {CHEV}
      </button>
      <div className="dd-pop">
        {filter && (
          <input
            ref={filterRef}
            className="dd-filter"
            type="text"
            placeholder="Type to filter…"
            aria-label={`Filter ${label}`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
        )}
        <ul
          ref={listRef}
          className="dd-list"
          role="listbox"
          id={listId}
          aria-label={label}
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown.length ? (
            shown.map((o, i) => (
              <li
                key={o.value}
                className={`dd-opt${i === active ? " active" : ""}`}
                role="option"
                aria-selected={o.value === value}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => choose(i)}
              >
                {o.label}
              </li>
            ))
          ) : (
            <li className="dd-empty">No matches</li>
          )}
        </ul>
      </div>
    </div>
  );
}
