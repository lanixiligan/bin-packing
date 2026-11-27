const trucks = (n) => `${n} truck${n === 1 ? "" : "s"}`;

// One row of the tally: a label, n little truck cells on a shared scale, and the count.
function TallyRow({ label, count, kind, extraFrom, note }) {
  return (
    <div className={`tally-row ${kind}`}>
      <div className="tally-label">{label}</div>
      <div className="tally-track" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={`tally-cell${extraFrom != null && i >= extraFrom ? " extra" : ""}`} />
        ))}
      </div>
      <div className="tally-count">
        <b>{count}</b> <span className="muted small">{count === 1 ? "truck" : "trucks"}</span>
        <div className="tally-note">{note}</div>
      </div>
    </div>
  );
}

// FFD vs OR-Tools vs the lower bound, on one shared scale, from the
// /api/solve response. Optional extras (DemoApp adds them with a pallet limit):
//   bound_note    replaces the "⌈total ÷ capacity⌉" note
//   bound_details [{ label, text, binding }]: the lower bound per dimension
// `segregated` (true when some dangerous goods must travel apart) adds a note:
// the lower bound ignores that.
export default function Summary({ result }) {
  const { ffd, ortools, lower_bound: lb, total_weight, capacity, bound_note, bound_details, segregated } = result;
  const saved = ffd.num_trucks - ortools.num_trucks;
  const scale = Math.max(ffd.num_trucks, ortools.num_trucks, lb);

  let verdict;
  if (saved > 0) {
    verdict = `OR-Tools saves ${trucks(saved)}: FFD used ${ffd.num_trucks}, OR-Tools used ${ortools.num_trucks}.`;
  } else if (saved < 0) {
    // Only possible if OR-Tools ran out of time before matching its FFD warm start.
    verdict = `FFD did better this time: OR-Tools ran out of time at ${trucks(ortools.num_trucks)}.`;
  } else {
    verdict = "FFD already found the best answer here: both use the same number of trucks.";
  }

  let floorNote;
  if (ortools.num_trucks === lb) {
    floorNote = `No plan can use fewer than ${trucks(lb)}, so ${ortools.num_trucks} is the best possible.`;
  } else if (ortools.optimal) {
    floorNote = segregated
      ? `The lower bound is ${lb}, but OR-Tools proved that ${ortools.num_trucks} is the fewest possible: some dangerous goods must travel apart, or the shipments don't split evenly enough.`
      : `The lower bound is ${lb}, but OR-Tools proved that ${ortools.num_trucks} is the fewest possible: the shipments don't split evenly enough to reach it.`;
  } else {
    floorNote = `The best possible is somewhere between ${lb} and ${ortools.num_trucks}; OR-Tools couldn't prove which in ${ortools.time_limit_s} s.`;
  }

  return (
    <section className="card summary" style={{ "--n": scale, "--lb": lb }} aria-label="Summary">
      <p className="verdict">{verdict}</p>
      <p className="floor-note">{floorNote}</p>

      <div className="tally">
        <TallyRow
          label="FFD"
          kind="ffd"
          count={ffd.num_trucks}
          extraFrom={saved > 0 ? ortools.num_trucks : null}
          note={`${ffd.solve_time_ms} ms`}
        />
        <TallyRow
          label="OR-Tools"
          kind="ortools"
          count={ortools.num_trucks}
          note={`${(ortools.solve_time_ms / 1000).toFixed(2)} s · ${ortools.optimal ? "optimal ✅" : "not proven ⏱️"}`}
        />
        <TallyRow
          label="Lower bound"
          kind="bound"
          count={lb}
          note={bound_note ?? `⌈${total_weight.toLocaleString()} ÷ ${capacity.toLocaleString()}⌉: no plan can use fewer`}
        />
      </div>

      {bound_details && <BoundDetails details={bound_details} />}
      {segregated && (
        <p className="dg-bound-note">
          ⚠️ Some dangerous goods are incompatible (ADG Code Table 9.1) and never share a truck. The lower bound
          only counts capacity and ignores this segregation, so it can be lower than any plan that keeps them apart.
        </p>
      )}

      <ul className="tally-legend small muted" aria-hidden="true">
        <li><span className="swatch ffd" /> truck used</li>
        {saved > 0 && <li><span className="swatch extra" /> extra truck FFD needed</li>}
        <li><span className="swatch line" /> lower bound</li>
      </ul>
    </section>
  );
}

/** The lower bound per limited dimension; the binding one is marked in text. */
function BoundDetails({ details }) {
  return (
    <div className="bound-details">
      <p className="small muted bound-details-title">Lower bound per dimension (the largest one counts):</p>
      <ul className="bound-details-list small">
        {details.map((d) => (
          <li key={d.label} className={d.binding ? "binding" : ""}>
            <b>{d.label}</b>: {d.text}
            {d.binding && <span className="bound-binding"> · binding</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
