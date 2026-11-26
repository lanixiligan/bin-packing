const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// One row of the tally: a label, n little truck cells on a shared scale, and the count.
function TallyRow({ label, count, kind, extraFrom, note, noun = "truck" }) {
  return (
    <div className={`tally-row ${kind}`}>
      <div className="tally-label">{label}</div>
      <div className="tally-track" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={`tally-cell${extraFrom != null && i >= extraFrom ? " extra" : ""}`} />
        ))}
      </div>
      <div className="tally-count">
        <b>{count}</b> <span className="muted small">{count === 1 ? noun : `${noun}s`}</span>
        <div className="tally-note">{note}</div>
      </div>
    </div>
  );
}

// FFD vs OR-Tools vs the lower bound, on one shared scale.
//
// The demo passes its /api/solve response. The ops plan page passes the same
// shape built from a SolveResult (see ops/plan/solveView.ts), plus optional:
//   noun          "load" instead of "truck"
//   bound_note    replaces the 1D "⌈total ÷ capacity⌉" note
//   bound_details [{ label, text, binding }]: the lower bound per dimension
//   ortools: null when CP-SAT found no solution in time (FFD is shown alone)
//   segregated    true when some dangerous goods must travel apart: the lower
//                 bound ignores that, so a note says so
//   dg_floor      like `segregated` for the wording of the "above the bound"
//                 sentence only (the caller shows its own segregation note)
export default function Summary({ result, noun = "truck" }) {
  const { ffd, lower_bound: lb, total_weight, capacity, bound_note, bound_details, segregated } = result;
  if (!result.ortools) return <FfdOnlySummary result={result} noun={noun} />;
  const { ortools } = result;
  const saved = ffd.num_trucks - ortools.num_trucks;
  const scale = Math.max(ffd.num_trucks, ortools.num_trucks, lb);
  const nouns = (n) => plural(n, noun);

  let verdict;
  if (saved > 0) {
    verdict = `OR-Tools saves ${nouns(saved)}: FFD used ${ffd.num_trucks}, OR-Tools used ${ortools.num_trucks}.`;
  } else if (saved < 0) {
    // Only possible if OR-Tools ran out of time before matching its FFD warm start.
    verdict = `FFD did better this time: OR-Tools ran out of time at ${ortools.num_trucks} ${noun}s.`;
  } else {
    verdict = `FFD already found the best answer here: both use the same number of ${noun}s.`;
  }

  let floorNote;
  if (ortools.num_trucks === lb) {
    floorNote = `No plan can use fewer than ${nouns(lb)}, so ${ortools.num_trucks} is the best possible.`;
  } else if (ortools.optimal) {
    floorNote = segregated || result.dg_floor
      ? `The lower bound is ${lb}, but OR-Tools proved that ${ortools.num_trucks} is the fewest possible: some dangerous goods must travel apart, or the ${noun === "truck" ? "shipments" : "items"} don't split evenly enough.`
      : `The lower bound is ${lb}, but OR-Tools proved that ${ortools.num_trucks} is the fewest possible: the ${noun === "truck" ? "shipments" : "items"} don't split evenly enough to reach it.`;
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
          noun={noun}
        />
        <TallyRow
          label="OR-Tools"
          kind="ortools"
          count={ortools.num_trucks}
          note={`${(ortools.solve_time_ms / 1000).toFixed(2)} s · ${ortools.optimal ? "optimal ✅" : "not proven ⏱️"}`}
          noun={noun}
        />
        <TallyRow
          label="Lower bound"
          kind="bound"
          count={lb}
          note={bound_note ?? `⌈${total_weight.toLocaleString()} ÷ ${capacity.toLocaleString()}⌉: no plan can use fewer`}
          noun={noun}
        />
      </div>

      {bound_details && <BoundDetails details={bound_details} />}
      {segregated && <SegregationNote noun={noun} />}

      <ul className="tally-legend small muted" aria-hidden="true">
        <li><span className="swatch ffd" /> {noun} used</li>
        {saved > 0 && <li><span className="swatch extra" /> extra {noun} FFD needed</li>}
        <li><span className="swatch line" /> lower bound</li>
      </ul>
    </section>
  );
}

/** Shown when incompatible dangerous goods had to go on separate trucks. */
function SegregationNote({ noun }) {
  return (
    <p className="dg-bound-note">
      ⚠️ Some dangerous goods are incompatible (ADG Code Table 9.1) and never share a {noun}. The lower bound
      only counts {noun === "truck" ? "weight" : "capacity"} and ignores this segregation, so it can be lower than any plan that keeps them apart.
    </p>
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

/** When OR-Tools has no solution: FFD against the lower bound only. */
function FfdOnlySummary({ result, noun }) {
  const { ffd, lower_bound: lb, bound_note, bound_details, segregated } = result;
  const scale = Math.max(ffd.num_trucks, lb);
  return (
    <section className="card summary" style={{ "--n": scale, "--lb": lb }} aria-label="Summary">
      <p className="verdict">
        OR-Tools found no solution in time, so only FFD's plan is available: {plural(ffd.num_trucks, noun)}.
      </p>
      <p className="floor-note">
        {ffd.num_trucks === lb
          ? `That matches the lower bound, so it is the best possible.`
          : `The best possible is somewhere between ${lb} and ${ffd.num_trucks}.`}
      </p>
      <div className="tally">
        <TallyRow label="FFD" kind="ffd" count={ffd.num_trucks} note={`${ffd.solve_time_ms} ms`} noun={noun} />
        <TallyRow label="Lower bound" kind="bound" count={lb} note={bound_note ?? "no plan can use fewer"} noun={noun} />
      </div>
      {bound_details && <BoundDetails details={bound_details} />}
      {segregated && <SegregationNote noun={noun} />}
    </section>
  );
}
