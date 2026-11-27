const trucks = (n) => `${n} truck${n === 1 ? "" : "s"}`;
const LABELS = { weight: "Weight", pallets: "Pallets" };

// The OR-Tools result in a few lines, from the /api/solve response: how many
// trucks, whether that is proven optimal, and the lower bound per dimension
// (no packing can use fewer trucks than ⌈total ÷ capacity⌉).
export default function Summary({ result }) {
  const { num_trucks: n, lower_bound: lb, lower_bounds: bounds, optimal, segregated } = result;
  const count = result.trucks.reduce((sum, t) => sum + t.shipments.length, 0);

  let note;
  if (n === lb) {
    note = `No packing can use fewer than ${trucks(lb)}, so this is the best possible.`;
  } else if (optimal) {
    note = segregated
      ? `The lower bound is ${lb}, but OR-Tools proved that ${n} is the fewest possible: some dangerous goods must travel apart, or the shipments don't split evenly enough.`
      : `The lower bound is ${lb}, but OR-Tools proved that ${n} is the fewest possible: the shipments don't split evenly enough to reach it.`;
  } else {
    note = `The best possible is somewhere between ${lb} and ${n}; OR-Tools couldn't prove which in ${result.time_limit_s} s.`;
  }

  const totals = { weight: [result.total_weight, result.capacity], pallets: [result.total_pallets, result.max_pallets] };
  return (
    <section className="card summary" aria-label="Summary">
      <p className="verdict">
        OR-Tools packed {count} shipment{count === 1 ? "" : "s"} into {trucks(n)}
        {optimal ? " ✅ proven optimal" : " ⏱️ best found, not proven"}.
      </p>
      <p className="floor-note">{note}</p>
      <ul className="summary-stats small">
        {Object.entries(bounds).map(([dim, value]) => (
          <li key={dim} className={value === lb ? "binding" : ""}>
            <b>{LABELS[dim] ?? dim} bound</b>: ⌈{totals[dim][0].toLocaleString()} ÷ {totals[dim][1].toLocaleString()}⌉ = {value}
            {value === lb && <span className="muted"> · binding</span>}
          </li>
        ))}
        <li><b>Solve time</b>: {(result.solve_time_ms / 1000).toFixed(2)} s ({result.status})</li>
      </ul>
      {segregated && (
        <p className="dg-bound-note">
          ⚠️ Some dangerous goods are incompatible (ADG Code Table 9.1) and never share a truck. The lower bound
          only counts capacity and ignores this segregation, so it can be lower than any packing that keeps them apart.
        </p>
      )}
    </section>
  );
}
