// A DG class diamond plus the class as text (the diamond alone never carries the meaning).
import { dgLabel, isGeneral, type DgLike } from "./rules";
import { DG_FILL, DG_ICON } from "./colors";
import "./dg.css";

/** Just the diamond for a class code ("3", "6", "F" = food, "R" = fire-risk). Decorative. */
export function DgDiamond({ code, size }: { code: string; size?: "sm" | "lg" }) {
  if (code === "F" || code === "R") {
    return <span className={`dg-dia sq${size ? ` ${size}` : ""}`} aria-hidden="true"><i>{DG_ICON[code]}</i></span>;
  }
  return <span className={`dg-dia${size ? ` ${size}` : ""}`} aria-hidden="true"><i style={{ "--fill": DG_FILL[code] } as React.CSSProperties} /></span>;
}

/** Diamond + "Class 3" (+ UN number). Renders nothing for general freight unless `showGeneral`. */
export function DgBadge({ dg, size = "sm", showUn = false, showGeneral = false }: {
  dg: DgLike; size?: "sm" | "lg"; showUn?: boolean; showGeneral?: boolean;
}) {
  if (isGeneral(dg)) return showGeneral ? <span className="dg-badge general">Not DG</span> : null;
  const code = dg?.dg_class ?? (dg?.food ? "F" : "R");
  return (
    <span className="dg-badge" title={dgLabel(dg)}>
      <DgDiamond code={code} size={size} />
      <span className="dg-text">
        {dgLabel(dg)}
        {showUn && dg?.un_number ? <span className="dg-sub"> · UN {dg.un_number}</span> : null}
        {dg?.packing_group ? <span className="dg-sub"> · PG {dg.packing_group}</span> : null}
      </span>
    </span>
  );
}
