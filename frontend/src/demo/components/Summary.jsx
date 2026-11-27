const trucks = (n) => `${n} truck${n === 1 ? "" : "s"}`;
const num = (n, max = 0) => n.toLocaleString("en-AU", { maximumFractionDigits: max });

/** Floor area (m²) of the shipments that can't stack: no packing puts anything on top of them. */
function unstackableFloorM2(result) {
  return result.trucks
    .flatMap((t) => t.shipments)
    .filter((s) => !s.stackable)
    .reduce((sum, s) => sum + (s.length_mm * s.width_mm) / 1e6, 0);
}

/**
 * The bounds of the /api/solve response as { dim, label, ratio, value }: no packing can
 * use fewer trucks than ⌈total ÷ what one truck holds⌉ in weight, volume or floor.
 */
function boundLines(result) {
  const { capacity: cap, lower_bounds: bounds } = result;
  const totals = {
    weight: ["Weight", `${num(result.total_weight)} ÷ ${num(cap.weight_kg)} kg`],
    volume: ["Volume", `${num(result.total_volume_m3, 1)} ÷ ${num(cap.volume_m3, 1)} m³`],
    floor: ["Floor", `${num(unstackableFloorM2(result), 1)} ÷ ${num(cap.floor_m2, 1)} m²`],
  };
  return Object.entries(bounds).map(([dim, value]) => {
    const [label, ratio] = totals[dim] ?? [dim, ""];
    return { dim, label, ratio, value };
  });
}

// The answer in a few lines, from the /api/solve response: how many trucks, whether that is
// proven optimal, why (the lower bounds: weight, volume and the floor that unstackable
// shipments need), and a one-line dangerous goods note. `children` go on the right of the
// headline (the view toggle).
export default function Summary({ result, children }) {
  const { num_trucks: n, lower_bound: lb, optimal, segregated } = result;
  const count = result.trucks.reduce((sum, t) => sum + t.shipments.length, 0);

  let note;
  if (n === lb) {
    note = `No packing can use fewer than ${trucks(lb)}, so this is the best possible.`;
  } else if (optimal) {
    note = segregated
      ? `The lower bound is ${lb}, but ${n} is proven to be the fewest: some dangerous goods must travel apart, or the shipments don't fit together on fewer decks.`
      : `The lower bound is ${lb}, but ${n} is proven to be the fewest: the shipments don't fit together on fewer decks.`;
  } else {
    note = `The best possible is between ${lb} and ${n}; OR-Tools couldn't prove which in ${result.time_limit_s} s.`;
  }

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
        <li>{count} shipments · {result.vehicle_name}</li>
        {boundLines(result).map(({ dim, label, ratio, value }) => (
          <li key={dim} title={value === lb ? "This bound sets the lower bound" : undefined}>
            {label} bound ⌈{ratio}⌉ = <b>{value}</b>
          </li>
        ))}
        <li>Solved in {(result.solve_time_ms / 1000).toFixed(2)} s</li>
      </ul>
      {segregated && (
        <details className="answer-dg">
          <summary>Incompatible dangerous goods travel in separate trucks.</summary>
          <p>
            ADG Code Table 9.1 keeps some classes apart. The lower bounds only count weight, volume and
            floor space, so with segregation the best packing can need more trucks than the bounds.
          </p>
        </details>
      )}
    </div>
  );
}
