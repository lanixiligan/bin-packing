const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

export default function Summary({ result }) {
  const { ffd, ortools, lower_bound: lb, total_weight, capacity } = result;
  const saved = ffd.num_trucks - ortools.num_trucks;
  const scale = Math.max(ffd.num_trucks, ortools.num_trucks, lb);

  let verdict;
  if (saved > 0) {
    verdict = `OR-Tools saves ${plural(saved, "truck")}: FFD used ${ffd.num_trucks}, OR-Tools used ${ortools.num_trucks}.`;
  } else if (saved < 0) {
    // Only possible if OR-Tools ran out of time before matching its FFD warm start.
    verdict = `FFD did better this time: OR-Tools ran out of time at ${ortools.num_trucks} trucks.`;
  } else {
    verdict = "FFD already found the best answer here: both use the same number of trucks.";
  }

  let floorNote;
  if (ortools.num_trucks === lb) {
    floorNote = `No plan can use fewer than ${plural(lb, "truck")}, so ${ortools.num_trucks} is the best possible.`;
  } else if (ortools.optimal) {
    floorNote = `The lower bound is ${lb}, but OR-Tools proved that ${ortools.num_trucks} is the fewest possible: the shipments don't split evenly enough to reach it.`;
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
          note={`⌈${total_weight.toLocaleString()} ÷ ${capacity.toLocaleString()}⌉: no plan can use fewer`}
        />
      </div>

      <ul className="tally-legend small muted" aria-hidden="true">
        <li><span className="swatch ffd" /> truck used</li>
        {saved > 0 && <li><span className="swatch extra" /> extra truck FFD needed</li>}
        <li><span className="swatch line" /> lower bound</li>
      </ul>
    </section>
  );
}
