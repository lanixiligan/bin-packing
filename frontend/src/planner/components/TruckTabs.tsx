// Split mode: an "All trucks" tab first, then one tab per truck (WAI-ARIA tabs with automatic
// activation). Each truck's tab shows its number, how much of the payload it uses and a status icon
// with a text alternative (fits / near a limit / over a limit), so the status never rests on colour
// alone.
//
// Keyboard: one tab stop (roving tabindex); Left / Right move and select (wrapping), Home / End jump
// to the first / last truck. With many trucks the strip scrolls sideways inside itself, with a fade
// on the side that has more.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PlanResult } from "../api/types.ts";
import { TRUCK_STATUS_TEXT, truckPanelId, truckStatus, truckTabId, type TruckChoice, type TruckStatus } from "../lib/fleet.ts";
import { formatPercent } from "../lib/units.ts";
import { AlertIcon, CheckIcon, CrossIcon, type IconProps } from "./icons.tsx";
import "./TruckTabs.css";

export interface TruckTabsProps {
  trucks: PlanResult[];
  /** Index of the selected truck, or "all". */
  selected: TruckChoice;
  onSelect(choice: TruckChoice): void;
  /** For the tab and panel ids (lib/fleet.ts truckTabId / truckPanelId). */
  idBase: string;
}

const STATUS_ICON: Record<TruckStatus, (props: IconProps) => React.JSX.Element> = {
  ok: CheckIcon,
  near: AlertIcon,
  over: CrossIcon,
};

export default function TruckTabs({ trucks, selected, onSelect, idBase }: TruckTabsProps) {
  // Tab positions: 0 is "All trucks", truck i is i + 1.
  const choices: TruckChoice[] = ["all", ...trucks.map((_, i) => i)];
  const position = selected === "all" ? 0 : selected + 1;
  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });

  // Fade the side of the strip that has more tabs out of view.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setFade((f) => (f.start === start && f.end === end ? f : { start, end }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [choices.length]);

  // Keep the selected tab in view inside the strip (never scrolls the page sideways).
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.children[position] as HTMLElement | undefined;
    if (!list || !tab) return;
    const left = tab.offsetLeft - 24;
    const right = tab.offsetLeft + tab.offsetWidth + 24;
    if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left);
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [position]);

  const move = (pos: number) => {
    onSelect(choices[pos]);
    (listRef.current?.children[pos] as HTMLElement | undefined)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = choices.length;
    let next: number;
    switch (e.key) {
      case "ArrowRight": next = (position + 1) % n; break;
      case "ArrowLeft": next = (position - 1 + n) % n; break;
      case "Home": next = 0; break;
      case "End": next = n - 1; break;
      default: return;
    }
    e.preventDefault();
    move(next);
  };

  return (
    <div className={`truck-tabs no-print${fade.start ? " has-more-start" : ""}${fade.end ? " has-more-end" : ""}`}>
      <div className="truck-tabs-list" role="tablist" aria-label="Trucks" aria-orientation="horizontal"
           ref={listRef} onKeyDown={onKeyDown}>
        <button type="button" role="tab" id={truckTabId(idBase, "all")} className="truck-tab truck-tab--all"
                aria-selected={selected === "all"} aria-controls={truckPanelId(idBase, "all")}
                tabIndex={selected === "all" ? 0 : -1} onClick={() => onSelect("all")}>
          <span className="truck-tab-name">All trucks</span>
        </button>
        {trucks.map((truck, i) => {
          const status = truckStatus(truck);
          const Icon = STATUS_ICON[status];
          const isSelected = i === selected;
          return (
            <button key={i} type="button" role="tab" id={truckTabId(idBase, i)}
                    className={`truck-tab truck-tab--${status}`}
                    aria-selected={isSelected} aria-controls={truckPanelId(idBase, i)}
                    tabIndex={isSelected ? 0 : -1} onClick={() => onSelect(i)}>
              <span className="truck-tab-name">Truck {i + 1}</span>
              <span className="truck-tab-meta num">
                {formatPercent(truck.utilisation.payload_kg.pct)}
                <span className="visually-hidden"> of payload, {TRUCK_STATUS_TEXT[status]}</span>
              </span>
              <span className="truck-tab-status" title={TRUCK_STATUS_TEXT[status]}><Icon size={16} /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
