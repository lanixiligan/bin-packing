// Pallet spaces, TEU, payload and volume: a meter per row with the exact numbers and the percentage
// beside it. Over 100 % turns the bar to the error colour and adds an "Over" label (never colour
// alone). A vehicle with no container slots shows "Not a container vehicle" instead of a TEU bar.
import { useId } from "react";
import type { Usage, Utilisation } from "../api/types.ts";
import { formatCount, formatPercent, useUnits } from "../lib/units.ts";
import { AlertIcon } from "./icons.tsx";
import "./UtilisationSummary.css";

export interface UtilisationSummaryProps {
  utilisation: Utilisation;
}

interface RowSpec {
  key: keyof Utilisation;
  label: string;
  usage: Usage;
  /** Exact numbers beside the bar, e.g. "18 / 22" or "14,530 kg / 24,000 kg". */
  numbers: string;
  /** Spoken value, e.g. "18 of 22 pallet spaces". */
  spoken: string;
}

function Row({ spec }: { spec: RowSpec }) {
  const labelId = useId();
  const { usage } = spec;
  const over = usage.used > usage.available;
  const pct = formatPercent(usage.pct);
  const fill = usage.available > 0 ? Math.min(100, Math.max(0, (usage.used / usage.available) * 100)) : 0;

  if (spec.key === "teu" && usage.available <= 0) {
    return (
      <li className="util-row util-row--na">
        <span className="util-label" id={labelId}>{spec.label}</span>
        <span className="util-na">Not a container vehicle</span>
      </li>
    );
  }

  return (
    <li className={`util-row ${over ? "util-row--over" : ""}`}>
      <div className="util-head">
        <span className="util-label" id={labelId}>{spec.label}</span>
        <span className="util-pct num">
          {over && <span className="util-over"><AlertIcon size={14} />Over</span>}
          {pct}
        </span>
      </div>
      <div className="util-bar" role="meter" aria-labelledby={labelId}
           aria-valuemin={0} aria-valuemax={usage.available} aria-valuenow={Math.min(usage.used, usage.available)}
           aria-valuetext={`${spec.spoken}, ${pct}${over ? ", over capacity" : ""}`}>
        <span className="util-fill" style={{ width: `${fill}%` }} />
      </div>
      <span className="util-numbers num">{spec.numbers}</span>
    </li>
  );
}

export default function UtilisationSummary({ utilisation }: UtilisationSummaryProps) {
  const units = useUnits();
  const headingId = useId();
  const { pallet_spaces: spaces, teu, payload_kg: payload, volume_m3: volume } = utilisation;
  const count = (n: number) => formatCount(n, 1);
  const teuCount = (n: number) => formatCount(n, 2);

  const rows: RowSpec[] = [
    {
      key: "pallet_spaces", label: "Pallet spaces", usage: spaces,
      numbers: `${count(spaces.used)} / ${count(spaces.available)}`,
      spoken: `${count(spaces.used)} of ${count(spaces.available)} pallet spaces`,
    },
    {
      key: "teu", label: "Containers (TEU)", usage: teu,
      numbers: `${teuCount(teu.used)} / ${teuCount(teu.available)}`,
      spoken: `${teuCount(teu.used)} of ${teuCount(teu.available)} TEU`,
    },
    {
      key: "payload_kg", label: "Payload", usage: payload,
      numbers: `${units.weight(payload.used)} / ${units.weight(payload.available)}`,
      spoken: `${units.weight(payload.used)} of ${units.weight(payload.available)} payload`,
    },
    {
      key: "volume_m3", label: "Volume", usage: volume,
      numbers: `${units.volume(volume.used)} / ${units.volume(volume.available)}`,
      spoken: `${units.volume(volume.used)} of ${units.volume(volume.available)} volume`,
    },
  ];

  return (
    <section className="card util" aria-labelledby={headingId} data-testid="utilisation">
      <div className="card-header">
        <h3 id={headingId} className="card-title">Capacity used</h3>
      </div>
      <ul className="util-list">
        {rows.map((spec) => <Row key={spec.key} spec={spec} />)}
      </ul>
    </section>
  );
}
