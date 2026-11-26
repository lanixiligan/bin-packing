// A plan's saved loads as cards: fill bars, vehicle and driver selects, and
// the lines on each load. In a draft, a line (or part of it) moves to another
// load, or to a new one, by drag-and-drop or with the "Move…" form, which
// does the same from the keyboard. The server re-checks the capacity and its
// 422 message is shown. A locked plan's loads are read-only, except for the
// vehicle and driver.
// Dangerous goods: each line shows its class; a load whose goods can't travel
// together is flagged (it blocks locking), the Move form and drag-and-drop
// mark loads the line would clash with (the server refuses those moves), and
// on Northline plans lines that need an HSEQ approval take its reference
// (also on a locked plan).
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";
import { errorMessage } from "../../api/errors";
import { overDims } from "../../components/capacity";
import { DgBadge } from "../../dg/DgBadge";
import { dgConflicts, dgLabel, isGeneral } from "../../dg/rules";
import { sizeText } from "../format";
import { useDrivers, useVehicles, vehicleLimits } from "../queries";
import { FillBars, LiveStatus } from "../ui";

type Plan = Schemas["PlanRead"];
type Load = Schemas["LoadRead"];
type Line = Schemas["LoadLineRead"];

/** Where a line goes: a load id, or null for a new load. */
type Target = number | null;

interface Move {
  line: Line;
  from: Load;
  to: Target;
  quantity: number;
  /** Started from the Move form: focus returns to the loads heading. */
  viaForm?: boolean;
}

const unitsText = (n: number) => `${n} unit${n === 1 ? "" : "s"}`;
const lineName = (l: Line) => `${l.item_name} (${l.order_reference})`;

/** A line already on `load` whose dangerous goods can't travel with `line` (ADG), if any. */
function clashWith(line: Line, load: Load): Line | undefined {
  if (isGeneral(line.dg)) return undefined;
  return load.lines.find((o) => o.order_line_id !== line.order_line_id && dgConflicts(line.dg, o.dg));
}

const clashText = (line: Line, load: Load, other: Line) =>
  `Load ${load.number} carries ${other.item_name} (${dgLabel(other.dg)}), and ${line.item_name} (${dgLabel(line.dg)}) can't travel with it.`;

export default function LoadEditor({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const editable = plan.status === "draft";
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  // the line being dragged (dataTransfer can't be read during dragover)
  const [drag, setDrag] = useState<{ line: Line; from: Load } | null>(null);
  const [dropTarget, setDropTarget] = useState<Target | undefined>(undefined);
  // a drop of a line with several units asks how many to move
  const [pendingDrop, setPendingDrop] = useState<Omit<Move, "quantity"> | null>(null);

  const move = useMutation({
    mutationFn: (m: Move) =>
      unwrap(api.POST("/api/ops/plans/{plan_id}/moves", {
        params: { path: { plan_id: plan.id } },
        body: {
          order_line_id: m.line.order_line_id,
          from_load_id: m.from.id,
          to_load_id: m.to,
          quantity: m.quantity,
        },
      })),
    onMutate: () => setMessage(null),
    onSuccess: (p, m) => {
      qc.setQueryData(["ops", "plan", plan.id], p);
      void qc.invalidateQueries({ queryKey: ["ops", "plans"] });
      const target = m.to == null ? "a new load" : `load ${plan.loads.find((l) => l.id === m.to)?.number ?? ""}`;
      setMessage({
        text: `Moved ${unitsText(m.quantity)} of ${lineName(m.line)} from load ${m.from.number} to ${target}.`
          + (p.loads.length !== plan.loads.length ? ` The plan now has ${p.loads.length} load${p.loads.length === 1 ? "" : "s"}.` : ""),
        tone: "good",
      });
    },
    onError: (e, m) => setMessage({ text: `Couldn't move ${lineName(m.line)}: ${errorMessage(e)}`, tone: "bad" }),
    // the Move form is gone: put keyboard focus back above the message
    onSettled: (_p, _e, m) => {
      if (m.viaForm) headingRef.current?.focus();
    },
  });

  function requestMove(m: Omit<Move, "quantity">, quantity?: number) {
    if (quantity == null && m.line.quantity > 1) {
      setPendingDrop(m);
      return;
    }
    move.mutate({ ...m, quantity: quantity ?? m.line.quantity });
  }

  // ---- drag-and-drop ----
  const dropProps = (target: Target) => {
    const valid = drag != null && drag.from.id !== target;
    return {
      onDragOver: (e: DragEvent) => {
        if (!valid) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dropTarget !== target) setDropTarget(target);
      },
      onDragLeave: (e: DragEvent) => {
        // only when leaving the card itself, not one of its children
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && dropTarget === target) setDropTarget(undefined);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (valid) requestMove({ line: drag.line, from: drag.from, to: target });
        setDrag(null);
        setDropTarget(undefined);
      },
    };
  };
  const dragProps = (line: Line, from: Load) => ({
    draggable: editable && !move.isPending,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${line.item_name} ×${line.quantity}`);
      setPendingDrop(null);
      setDrag({ line, from });
    },
    onDragEnd: () => {
      setDrag(null);
      setDropTarget(undefined);
    },
  });

  const overCount = plan.loads.filter((l) => l.over_capacity).length;
  const dgLoads = plan.loads.filter((l) => l.dg_conflicts.length);
  const approvalsMissing = plan.loads.reduce((n, l) => n + l.approvals_missing, 0);

  return (
    <section className="load-editor" aria-labelledby="loads-h">
      <div className="section-head">
        <h2 id="loads-h" ref={headingRef} tabIndex={-1}>
          {plan.loads.length} load{plan.loads.length === 1 ? "" : "s"}
        </h2>
        {editable ? (
          <p className="muted small">
            Drag a line onto another load, or use <b>Move…</b>, to move all or some of its units. The server checks every move against the load's capacity.
          </p>
        ) : (
          <p className="muted small">The plan is locked: its loads are final. You can still assign vehicles and drivers.</p>
        )}
      </div>
      {overCount > 0 ? (
        <p className="warn-box">
          ⚠️ {overCount === 1 ? "One load is" : `${overCount} loads are`} over capacity.
          {editable ? " Move lines out of it, or assign a bigger vehicle, before locking the plan." : " Assign a bigger vehicle."}
        </p>
      ) : null}
      {dgLoads.length > 0 ? (
        <p className="warn-box dg-bad-box">
          ⚠️ {dgLoads.length === 1 ? `Load ${dgLoads[0].number} carries` : `Loads ${dgLoads.map((l) => l.number).join(", ")} carry`} dangerous
          goods that can't travel together.
          {editable ? " Move one of them to another load before locking the plan." : " Check the loading with the dispatcher in charge."}
        </p>
      ) : null}
      {approvalsMissing > 0 ? (
        <p className="warn-box">
          ⚠️ {approvalsMissing === 1 ? "One line needs" : `${approvalsMissing} lines need`} a Northline HSEQ approval
          (Safety@northline.com.au). Record the approval reference on the line{editable ? " before locking the plan" : ""}.
        </p>
      ) : null}
      <LiveStatus message={message?.text} tone={message?.tone} />
      {move.isPending ? <p className="small muted" aria-hidden="true"><span className="spinner" /> Moving…</p> : null}

      <ol className="load-grid">
        {plan.loads.map((load) => (
          <li key={load.id}>
            <LoadCard
              plan={plan}
              load={load}
              editable={editable}
              busy={move.isPending}
              dragging={drag}
              isDropTarget={dropTarget === load.id}
              dropProps={editable ? dropProps(load.id) : {}}
              dragProps={dragProps}
              pendingDrop={pendingDrop?.to === load.id ? pendingDrop : null}
              onConfirmDrop={(q) => {
                if (pendingDrop) move.mutate({ ...pendingDrop, quantity: q, viaForm: true });
                setPendingDrop(null);
              }}
              onCancelDrop={() => setPendingDrop(null)}
              onMove={(m) => requestMove({ ...m, viaForm: true }, m.quantity)}
            />
          </li>
        ))}
        {editable ? (
          <li>
            <div
              className={`new-load-zone${drag ? " active" : ""}${dropTarget === null ? " over" : ""}`}
              {...dropProps(null)}
            >
              {pendingDrop && pendingDrop.to === null ? (
                <DropQuantity
                  move={pendingDrop}
                  onConfirm={(q) => {
                    move.mutate({ ...pendingDrop, quantity: q, viaForm: true });
                    setPendingDrop(null);
                  }}
                  onCancel={() => setPendingDrop(null)}
                />
              ) : (
                <p className="muted">
                  <span aria-hidden="true">＋ </span>
                  {drag ? "Drop here to start a new load" : "New load: drag a line here, or choose “A new load” under Move…"}
                </p>
              )}
            </div>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function LoadCard({ plan, load, editable, busy, dragging, isDropTarget, dropProps, dragProps, pendingDrop, onConfirmDrop, onCancelDrop, onMove }: {
  plan: Plan;
  load: Load;
  editable: boolean;
  busy: boolean;
  dragging: { line: Line; from: Load } | null;
  isDropTarget: boolean;
  dropProps: Record<string, unknown>;
  dragProps: (line: Line, from: Load) => Record<string, unknown>;
  pendingDrop: Omit<Move, "quantity"> | null;
  onConfirmDrop: (quantity: number) => void;
  onCancelDrop: () => void;
  onMove: (m: Move) => void;
}) {
  const [moving, setMoving] = useState<number | null>(null); // assignment id with the Move form open
  const over = overDims(load.usage, load.capacity);
  const canDrop = dragging != null && dragging.from.id !== load.id;
  const clash = canDrop ? clashWith(dragging.line, load) : undefined;
  const dgBad = load.dg_conflicts.length > 0;
  const titleId = `load-${load.id}-h`;

  return (
    <article
      className={`card load-card${load.over_capacity ? " over" : ""}${dgBad ? " dg-bad" : ""}${canDrop ? " can-drop" : ""}${clash ? " drop-clash" : ""}${isDropTarget ? " drop-over" : ""}`}
      aria-labelledby={titleId}
      {...dropProps}
    >
      <header className="load-card-head">
        <h3 id={titleId}>Load {load.number}</h3>
        <span className="load-card-chips">
          {load.over_capacity ? <span className="chip bad-chip">Over capacity</span> : null}
          {dgBad ? <span className="chip bad-chip">DG conflict</span> : null}
          {load.approvals_missing ? <span className="chip warn-chip">Approval needed</span> : null}
        </span>
      </header>

      <FillBars usage={load.usage} capacity={load.capacity} />
      {over.length ? (
        <p className="warn-box small">
          ⚠️ Over capacity in {over.map((d) => `${d.label.toLowerCase()} (${d.format(load.usage[d.field])} of ${d.format(load.capacity[d.field] as number)})`).join(" and ")}.
        </p>
      ) : null}

      {dgBad ? (
        <div className="warn-box small dg-bad-box">
          <p><b>⚠️ Dangerous goods that can't travel together</b></p>
          <ul>{load.dg_conflicts.map((c) => <li key={c.order_line_ids.join("-")}>{c.message}</li>)}</ul>
        </div>
      ) : null}
      {load.dg_warnings.length ? (
        <div className="warn-box small">
          <p><b>Dangerous goods checks</b></p>
          <ul>{load.dg_warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      ) : null}

      <Assignment plan={plan} load={load} />

      <h4 className="load-lines-title">Lines <span className="muted small">({load.lines.reduce((s, l) => s + l.quantity, 0)} units)</span></h4>
      <ul className="load-lines">
        {load.lines.map((line) => (
          <li
            key={line.assignment_id}
            className={`load-line${editable ? " movable" : ""}${dragging?.line.assignment_id === line.assignment_id ? " dragging" : ""}`}
            {...dragProps(line, load)}
          >
            <div className="load-line-row">
              {editable ? <span className="drag-handle" aria-hidden="true" title="Drag to another load">⠿</span> : null}
              <div className="load-line-main">
                <b>{line.quantity} × {line.item_name}</b> <DgBadge dg={line.dg} showUn />
                {line.quantity < line.line_quantity ? (
                  <span className="small muted"> ({line.quantity} of {line.line_quantity}; the rest is on other loads)</span>
                ) : null}
                <div className="small muted">
                  {line.order_reference} · {line.company_name} · {sizeText(
                    line.unit_weight_kg * line.quantity,
                    line.unit_volume_m3 * line.quantity,
                    line.unit_pallet_spaces * line.quantity,
                  )}
                </div>
              </div>
              {editable ? (
                <button
                  type="button"
                  className="secondary move-button"
                  aria-expanded={moving === line.assignment_id}
                  disabled={busy}
                  onClick={() => setMoving(moving === line.assignment_id ? null : line.assignment_id)}
                >
                  Move…<span className="sr-only"> {line.quantity} × {line.item_name}, {line.order_reference}</span>
                </button>
              ) : null}
            </div>
            {line.dg_approval_required ? <Approval plan={plan} line={line} /> : null}
            {editable && moving === line.assignment_id ? (
              <MoveForm
                plan={plan}
                line={line}
                from={load}
                onCancel={() => setMoving(null)}
                onMove={(m) => {
                  setMoving(null);
                  onMove(m);
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>

      {pendingDrop ? <DropQuantity move={pendingDrop} onConfirm={onConfirmDrop} onCancel={onCancelDrop} /> : null}
      {canDrop ? (
        clash ? (
          <p className="drop-hint clash small" aria-hidden="true">⚠️ DG conflict: {clashText(dragging.line, load, clash)}</p>
        ) : <p className="drop-hint small" aria-hidden="true">Drop here to move it to load {load.number}</p>
      ) : null}
    </article>
  );
}

/** Keyboard-friendly move: choose the target load and how many units. */
function MoveForm({ plan, line, from, onMove, onCancel }: {
  plan: Plan;
  line: Line;
  from: Load;
  onMove: (m: Move) => void;
  onCancel: () => void;
}) {
  const others = plan.loads.filter((l) => l.id !== from.id);
  // start on a load the line can travel on
  const first = others.find((l) => !clashWith(line, l)) ?? others[0];
  const [target, setTarget] = useState<string>(first ? String(first.id) : "new");
  const targetLoad = others.find((l) => String(l.id) === target);
  const clash = targetLoad ? clashWith(line, targetLoad) : undefined;
  const [quantity, setQuantity] = useState(String(line.quantity));
  const id = `move-${line.assignment_id}`;
  const q = Number(quantity);
  const validQ = Number.isInteger(q) && q >= 1 && q <= line.quantity;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validQ) return;
    onMove({ line, from, to: target === "new" ? null : Number(target), quantity: q });
  };

  return (
    <form className="move-form" onSubmit={submit} aria-label={`Move ${line.item_name} (${line.order_reference})`}>
      <label className="field" htmlFor={`${id}-to`}>
        <span>Move to</span>
        <select
        id={`${id}-to`}
        value={target}
        // the form opens on demand, so the first field takes focus
        autoFocus
        onChange={(e) => setTarget(e.target.value)}
        aria-describedby={clash ? `${id}-clash` : undefined}
      >
        {others.map((l) => (
          <option key={l.id} value={l.id}>
            Load {l.number}{l.over_capacity ? " (over capacity)" : ""}{clashWith(line, l) ? " (DG conflict)" : ""}
          </option>
        ))}
          <option value="new">A new load</option>
        </select>
      </label>
      {line.quantity > 1 ? (
        <label className="field" htmlFor={`${id}-qty`}>
          <span>Units <span className="hint">(of {line.quantity})</span></span>
          <input
            id={`${id}-qty`}
            type="number"
            min={1}
            max={line.quantity}
            step={1}
            inputMode="numeric"
            className="num-input"
            value={quantity}
            aria-invalid={!validQ || undefined}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
      ) : null}
      <div className="move-form-actions">
        <button type="submit" className="primary" disabled={!validQ}>Move</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
      {!validQ ? <span className="field-error">Enter a whole number from 1 to {line.quantity}.</span> : null}
      {clash && targetLoad ? (
        <span id={`${id}-clash`} className="field-error">⚠️ {clashText(line, targetLoad, clash)} Choose another load.</span>
      ) : null}
    </form>
  );
}

/** After dropping a line with several units: how many to move (all by default). */
function DropQuantity({ move, onConfirm, onCancel }: {
  move: Omit<Move, "quantity">;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
}) {
  const [quantity, setQuantity] = useState(String(move.line.quantity));
  const q = Number(quantity);
  const valid = Number.isInteger(q) && q >= 1 && q <= move.line.quantity;
  const id = `drop-qty-${move.line.assignment_id}`;
  return (
    <form
      className="drop-quantity"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onConfirm(q);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <label htmlFor={id}>
        Move how many of <b>{move.line.item_name}</b> ({move.line.order_reference}) from load {move.from.number}?
      </label>
      <div className="drop-quantity-row">
        <input
          id={id}
          type="number"
          min={1}
          max={move.line.quantity}
          step={1}
          inputMode="numeric"
          className="num-input"
          value={quantity}
          // appears right after the drop: type a number and press Enter
          autoFocus
          aria-invalid={!valid || undefined}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <span className="small muted">of {move.line.quantity}</span>
        <button type="submit" className="primary" disabled={!valid}>Move</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Northline HSEQ approval reference of a line that needs one (editable on locked plans too). */
function Approval({ plan, line }: { plan: Plan; line: Line }) {
  const qc = useQueryClient();
  const [changing, setChanging] = useState(false);
  const [value, setValue] = useState(line.dg_approval_ref ?? "");
  const [saved, setSaved] = useState("");
  const save = useMutation({
    mutationFn: (ref: string | null) =>
      unwrap(api.PATCH("/api/ops/order-lines/{line_id}", {
        params: { path: { line_id: line.order_line_id } },
        body: { dg_approval_ref: ref },
      })),
    onMutate: () => setSaved(""),
    onSuccess: (r) => {
      setChanging(false);
      setValue(r.dg_approval_ref ?? "");
      setSaved(r.dg_approval_ref ? `Approval ${r.dg_approval_ref} saved for ${lineName(line)}.` : `Approval cleared for ${lineName(line)}.`);
      void qc.invalidateQueries({ queryKey: ["ops", "plan", plan.id] });
      void qc.invalidateQueries({ queryKey: ["ops", "order", line.order_id] });
    },
  });
  const id = `approval-${line.assignment_id}`;
  const editing = changing || !line.dg_approval_ref;

  return (
    <div className="dg-approval">
      {editing ? (
        <form
          className="dg-approval-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(value.trim() || null);
          }}
        >
          <label htmlFor={id} className="small">
            Northline HSEQ approval reference<span className="sr-only"> for {lineName(line)}</span>
          </label>
          <div className="dg-approval-row">
            <input
              id={id}
              value={value}
              maxLength={100}
              placeholder="e.g. HSEQ-2041"
              disabled={save.isPending}
              onChange={(e) => setValue(e.target.value)}
            />
            <button type="submit" className="primary" disabled={save.isPending || (!value.trim() && !line.dg_approval_ref)}>
              {save.isPending ? "Saving…" : "Save"}<span className="sr-only"> approval for {lineName(line)}</span>
            </button>
            {changing ? <button type="button" className="secondary" onClick={() => { setChanging(false); setValue(line.dg_approval_ref ?? ""); }}>Cancel</button> : null}
          </div>
        </form>
      ) : (
        <p className="small dg-approved">
          <span className="good-text">✓ Approved: <b>{line.dg_approval_ref}</b></span>{" "}
          <button type="button" className="link-button" onClick={() => setChanging(true)}>
            Change<span className="sr-only"> the approval for {lineName(line)}</span>
          </button>
        </p>
      )}
      <div role="status" aria-live="polite" className="small">{saved ? <span className="sr-only">{saved}</span> : null}</div>
      {save.error ? <div className="error small" role="alert">⚠️ {errorMessage(save.error)}</div> : null}
    </div>
  );
}

/** Vehicle and driver of one load: saved as soon as a select changes. */
function Assignment({ plan, load }: { plan: Plan; load: Load }) {
  const qc = useQueryClient();
  const vehicles = useVehicles();
  const drivers = useDrivers();
  const [saved, setSaved] = useState("");
  const update = useMutation({
    mutationFn: (body: Schemas["LoadUpdate"]) =>
      unwrap(api.PATCH("/api/ops/loads/{load_id}", { params: { path: { load_id: load.id } }, body })),
    onMutate: () => setSaved(""),
    onSuccess: (l, body) => {
      setSaved("vehicle_id" in body
        ? (l.vehicle ? `Load ${l.number}: vehicle ${l.vehicle.name}.` : `Load ${l.number}: no vehicle.`)
        : (l.driver ? `Load ${l.number}: driver ${l.driver.name}.` : `Load ${l.number}: no driver.`));
      void qc.invalidateQueries({ queryKey: ["ops", "plan", plan.id] });
    },
  });

  // inactive ones stay listed while assigned
  const vehicleOptions = (vehicles.data ?? []).filter((v) => v.active || v.id === load.vehicle?.id);
  if (load.vehicle && !vehicleOptions.some((v) => v.id === load.vehicle!.id)) vehicleOptions.push(load.vehicle);
  const driverOptions = (drivers.data ?? []).filter((d) => d.active || d.id === load.driver?.id);
  if (load.driver && !driverOptions.some((d) => d.id === load.driver!.id)) driverOptions.push(load.driver);
  const vId = `load-${load.id}-vehicle`;
  const dId = `load-${load.id}-driver`;

  return (
    <div className="load-assign">
      <label className="field" htmlFor={vId}>
        <span>Vehicle</span>
        <select
          id={vId}
          value={load.vehicle?.id ?? ""}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ vehicle_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Not assigned (packed for {plan.vehicle.name})</option>
          {vehicleOptions.map((v) => (
            <option key={v.id} value={v.id}>{v.name} ({v.registration}): {vehicleLimits(v)}</option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={dId}>
        <span>Driver</span>
        <select
          id={dId}
          value={load.driver?.id ?? ""}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ driver_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">No driver</option>
          {driverOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      {plan.status === "locked" && !load.driver ? (
        <p className="small warn-text">No driver yet: this load isn't on anyone's run.</p>
      ) : null}
      <div role="status" aria-live="polite" className="small">
        {update.isPending ? <span className="muted">Saving…</span> : saved ? <span className="good-text">✓ {saved}</span> : null}
      </div>
      {update.error ? <div className="error small" role="alert">⚠️ {errorMessage(update.error)}</div> : null}
    </div>
  );
}
