import { fractions, limitedDims } from "./capacity.ts";

/**
 * Small labelled fill bars, one per limited dimension. The text ("kg 80%")
 * carries the meaning, not the color. Decorative for screen readers: the
 * caller puts the same numbers in an accessible label.
 */
export default function DimBars({ usage, cap, compact = false }) {
  const f = fractions(usage, cap);
  return (
    <div className={`dim-bars${compact ? " compact" : ""}`} aria-hidden="true">
      {limitedDims(cap).map((d) => {
        const pct = Math.floor(100 * f[d.dim] + 1e-9);
        return (
          <div key={d.dim} className={`dim-bar${pct > 100 ? " over" : ""}`}>
            <span className="dim-bar-label">{compact ? d.short : d.label}</span>
            <span className="dim-bar-track">
              <span className="dim-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
            </span>
            <span className="dim-bar-pct">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}
