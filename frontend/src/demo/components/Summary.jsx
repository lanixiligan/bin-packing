const trucks = (n) => `${n} truck${n === 1 ? "" : "s"}`;
const LABELS = { weight: "Weight", pallets: "Pallets" };

// The answer in a few lines, from the /api/solve response: how many trucks,
// whether that is proven optimal, why (the lower bound per dimension: no packing
// can use fewer trucks than ⌈total ÷ capacity⌉), and a one-line dangerous goods
// note. `children` go on the right of the headline (the view toggle).
export default function Summary({ result, children }) {
  const { num_trucks: n, lower_bound: lb, lower_bounds: bounds, optimal, segregated } = result;
  const count = result.trucks.reduce((sum, t) => sum + t.shipments.length, 0);

  let note;
  if (n === lb) {
    note = `No packing can use fewer than ${trucks(lb)}, so this is the best possible.`;
  } else if (optimal) {
    note = segregated
      ? `The lower bound is ${lb}, but ${n} is proven to be the fewest: some dangerous goods must travel apart, or the shipments don't split evenly enough.`
      : `The lower bound is ${lb}, but ${n} is proven to be the fewest: the shipments don't split evenly enough to reach it.`;
  } else {
    note = `The best possible is between ${lb} and ${n}; OR-Tools couldn't prove which in ${result.time_limit_s} s.`;
  }

  const totals = { weight: [result.total_weight, result.capacity], pallets: [result.total_pallets, result.max_pallets] };
  return (
    <div className="answer">
      <div className="answer-head">
        <div className="answer-title">
          <h2 id="results-title" className="answer-count">
            <span className="num">{n}</span> {n === 1 ? "truck" : "trucks"}
            <span className="sr-only"> for {count} shipment{count === 1 ? "" : "s"}</span>
          </h2>
          {optimal
            ? <span className="badge badge-success">Proven optimal</span>
            : <span className="badge badge-warning">Best found, not proven</span>}
        </div>
        {children}
      </div>
      <p className="answer-note">{note}</p>
      <ul className="answer-facts">
        <li>{count} shipments</li>
        {Object.entries(bounds).map(([dim, value]) => (
          <li key={dim} title={value === lb ? "This bound sets the lower bound" : undefined}>
            {LABELS[dim] ?? dim} bound ⌈{totals[dim][0].toLocaleString()} ÷ {totals[dim][1].toLocaleString()}⌉ = <b>{value}</b>
          </li>
        ))}
        <li>Solved in {(result.solve_time_ms / 1000).toFixed(2)} s</li>
      </ul>
      {segregated && (
        <details className="answer-dg">
          <summary>Incompatible dangerous goods travel in separate trucks.</summary>
          <p>
            ADG Code Table 9.1 keeps some classes apart. The lower bound only counts weight and pallet
            spaces, so with segregation the best packing can need more trucks than the bound.
          </p>
        </details>
      )}
    </div>
  );
}
