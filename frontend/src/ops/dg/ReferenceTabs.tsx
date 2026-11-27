// The reference part of /ops/dg as tabs (exceptions, Table 9.2, segregation, Northline)
// instead of one long scroll. The open tab lives in the URL (?ref=) so it can be linked.
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import NorthlineSection from "./NorthlineSection";
import { ExceptionsCard, SegregationCard, Table92Card } from "./ReferenceSections";
import type { RefTab } from "./codes";

const TABS: { id: RefTab; label: string; render: () => ReactNode }[] = [
  { id: "exceptions", label: "Exceptions", render: () => <ExceptionsCard /> },
  { id: "t92", label: "Table 9.2", render: () => <Table92Card /> },
  { id: "segregation", label: "Segregation", render: () => <SegregationCard /> },
  { id: "northline", label: "Northline", render: () => <NorthlineSection /> },
];

export default function ReferenceTabs({ value, onChange, northline }: {
  value: RefTab;
  onChange: (t: RefTab) => void;
  /** Show the Northline tab (the ADG + Northline rule set). */
  northline: boolean;
}) {
  const tabs = TABS.filter((t) => northline || t.id !== "northline");
  const list = useRef<HTMLDivElement>(null);
  const current = tabs.find((t) => t.id === value) ?? tabs[0];

  // Arrow keys move between tabs and select them (automatic activation).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === current.id);
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    list.current?.querySelector<HTMLButtonElement>(`#dgc-tab-${tabs[next].id}`)?.focus();
  };

  return (
    <section className="dgc-ref" aria-labelledby="dgc-ref-h">
      <h2 id="dgc-ref-h" className="dgc-h2">Reference</h2>
      <div className="dgc-tabs" role="tablist" aria-labelledby="dgc-ref-h" ref={list} onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const on = t.id === current.id;
          return (
            <button
              key={t.id}
              id={`dgc-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="dgc-tabpanel"
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div id="dgc-tabpanel" role="tabpanel" tabIndex={0} aria-labelledby={`dgc-tab-${current.id}`} className="dgc-tabpanel">
        {current.render()}
      </div>
    </section>
  );
}
