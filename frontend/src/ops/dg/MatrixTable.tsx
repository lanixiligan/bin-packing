// ADG Code Table 9.1 as a table of buttons: selecting a cell loads that pair.
import { COLS, MATRIX, ROWS, type Col } from "../../dg/rules";
import { DgDiamond } from "../../dg/DgBadge";
import { COL_NAMES, codeKind, codeWords } from "./codes";

/** "0(3)" as 0 with a superscript 3. */
export function Code({ k }: { k: string }) {
  const m = k.match(/^(0|N)\((\d)\)$/);
  return m ? <>{m[1]}<sup>{m[2]}</sup></> : <>{k}</>;
}

const colLabel = (c: Col) => (c === "F" ? "Food" : c === "R" ? "Fire-risk" : c);
const colText = (c: Col) => (c === "F" ? "food" : c === "R" ? "fire-risk goods" : `Class ${c}`);

export default function MatrixTable({ selRow, selCol, onPick }: {
  /** The selected pair as a row and column of the table (null: no DG class on either side). */
  selRow: Col | null;
  selCol: Col | null;
  onPick: (row: Col, col: Col) => void;
}) {
  return (
    <div className="dgc-scroll dgc-mx-scroll" role="region" aria-labelledby="dgc-mx-cap" tabIndex={0}>
      <table className="dgc-mx">
        <caption id="dgc-mx-cap" className="sr-only">ADG Code Table 9.1: incompatibility based on classification. Rows and columns are classes.</caption>
        <thead>
          <tr>
            <th scope="col" className="dgc-mx-corner"><span className="sr-only">Class</span></th>
            {COLS.map((c) => (
              <th key={c} scope="col" className={c === "F" ? "sep" : undefined}>
                <span className="dgc-stack">
                  <DgDiamond code={c} size="sm" />
                  <span><span className="sr-only">{COL_NAMES[c]}, </span>{colLabel(c)}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r} className={r === selRow ? "hl" : undefined}>
              <th scope="row">
                <span className="dgc-rh">
                  <DgDiamond code={r} size="sm" />
                  <b>{r}{r === "7" ? <sup>7</sup> : null}</b>
                  <span className="dgc-rh-name">{COL_NAMES[r]}</span>
                </span>
              </th>
              {COLS.map((c, i) => {
                const k = MATRIX[r][i];
                const sel = r === selRow && c === selCol;
                const hl = !sel && (r === selRow || c === selCol);
                const cls = [`c-${codeKind(k)}`, c === "F" ? "sep" : "", sel ? "sel" : hl ? "hl" : ""].filter(Boolean).join(" ");
                return (
                  <td key={c} className={cls}>
                    <button
                      type="button"
                      aria-label={`Class ${r} with ${colText(c)}: ${k}, ${codeWords(k)}${sel ? " (the pair in the checker)" : ""}. Load this pair.`}
                      aria-current={sel ? "true" : undefined}
                      onClick={() => onPick(r, c)}
                    >
                      <Code k={k} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
