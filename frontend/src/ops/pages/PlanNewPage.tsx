// /ops/plans/new — Choose date, zone and vehicle profile, then run the optimiser.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";
import { ApiError, errorMessage } from "../../api/errors";
import { PageHeader } from "../../shell/AppShell";
import { formatDate, todayIso } from "../../shell/format";
import { lowerBounds } from "../../components/capacity";
import { sizeText } from "../format";
import { useVehicles, useZones, vehicleCapacity, vehicleLimits } from "../queries";

type Infeasible = Schemas["InfeasibleDetail"];
type RuleSet = Schemas["RuleSet"];
type DgIssue = Schemas["DgIssue"];

const isInfeasible = (d: unknown): d is Infeasible =>
  !!d && typeof d === "object" && "misfits" in d && Array.isArray((d as Infeasible).misfits);

const DIM_LABEL = { weight: "weight", volume: "volume", pallets: "pallets" } as const;

const RULE_SETS: { value: RuleSet; label: string; hint: string }[] = [
  { value: "adg", label: "ADG Code", hint: "Keeps incompatible dangerous goods on separate loads (segregation, Table 9.1 and 9.2)." },
  {
    value: "northline", label: "ADG + Northline acceptance",
    hint: "Also refuses goods Northline won't carry or quantities over its limits, and asks for HSEQ approval references.",
  },
];

const ISSUE_KIND: Record<DgIssue["kind"], string> = {
  prohibited: "Not accepted", limit: "Over the limit", approval: "Needs approval", note: "Note",
};

/** DG issues grouped by order, in the order they came. */
function byOrder(issues: DgIssue[]): { orderId: number; reference: string; issues: DgIssue[] }[] {
  const groups = new Map<number, { orderId: number; reference: string; issues: DgIssue[] }>();
  for (const i of issues) {
    let g = groups.get(i.order_id);
    if (!g) {
      g = { orderId: i.order_id, reference: i.order_reference, issues: [] };
      groups.set(i.order_id, g);
    }
    g.issues.push(i);
  }
  return [...groups.values()];
}

/** The backend prefixes each message with "REF: item: "; the list already shows both. */
const issueText = (i: DgIssue) => {
  let m = i.message;
  if (m.startsWith(`${i.order_reference}: `)) m = m.slice(i.order_reference.length + 2);
  if (i.item_name && m.startsWith(`${i.item_name}: `)) m = m.slice(i.item_name.length + 2);
  return m;
};

export default function PlanNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [date, setDate] = useState(params.get("date") ?? todayIso(1));
  const [zone, setZone] = useState(params.get("zone") ?? "");
  const [vehicleId, setVehicleId] = useState("");
  const [ruleSet, setRuleSet] = useState<RuleSet>("adg");

  const zones = useZones();
  const vehicles = useVehicles();
  const batches = useQuery({
    queryKey: ["ops", "batches", { date }],
    queryFn: () => unwrap(api.GET("/api/ops/batches", { params: { query: { from_date: date, to_date: date } } })),
    enabled: !!date,
  });

  const vehicle = vehicles.data?.find((v) => String(v.id) === vehicleId);
  const batch = batches.data?.find((b) => b.zone === zone);
  const estimate = vehicle && batch?.unplanned_orders
    ? lowerBounds(
      { weight_kg: batch.total_weight_kg, volume_m3: batch.total_volume_m3, pallets: batch.total_pallet_spaces },
      vehicleCapacity(vehicle),
    ).overall
    : null;

  const create = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/ops/plans", { body: { delivery_date: date, zone, vehicle_id: Number(vehicleId), rule_set: ruleSet } })),
    onSuccess: (plan) => {
      void qc.invalidateQueries({ queryKey: ["ops"] });
      navigate(`/ops/plans/${plan.id}`);
    },
  });
  const infeasible = create.error instanceof ApiError && isInfeasible(create.error.detail) ? create.error.detail : null;

  return (
    <>
      <p className="breadcrumb"><Link to="/ops/plans">← Plans</Link></p>
      <PageHeader title="New plan" subtitle="Every accepted, unplanned order of the batch is packed into loads that fit the vehicle you choose." />

      <form
        className="card plan-form"
        aria-labelledby="plan-form-h"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h2 id="plan-form-h" className="sr-only">Plan settings</h2>
        <div className="form-grid">
          <label className="field">
            <span>Delivery date</span>
            <input type="date" required value={date} onChange={(e) => { setDate(e.target.value); create.reset(); }} />
          </label>
          <label className="field">
            <span>Zone</span>
            <select required value={zone} onChange={(e) => { setZone(e.target.value); create.reset(); }}>
              <option value="" disabled>Choose a zone</option>
              {zones.data?.filter((z) => z.active || z.code === zone).map((z) => (
                <option key={z.code} value={z.code}>{z.code} · {z.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Vehicle profile <span className="hint">(every load is packed against it)</span></span>
            <select required value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); create.reset(); }} aria-describedby="vehicle-limits">
              <option value="" disabled>Choose a vehicle</option>
              {vehicles.data?.map((v) => (
                <option key={v.id} value={v.id}>{v.name} ({v.registration}): {vehicleLimits(v)}</option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="method-choice rule-set-choice">
          <legend>Dangerous goods rules</legend>
          {RULE_SETS.map((r) => (
            <label key={r.value} className={`method-option${ruleSet === r.value ? " on" : ""}`}>
              <input
                type="radio"
                name="rule_set"
                value={r.value}
                checked={ruleSet === r.value}
                aria-describedby={`rule-${r.value}-hint`}
                onChange={() => { setRuleSet(r.value); create.reset(); }}
              />
              <span>
                <b>{r.label}</b>
                <span id={`rule-${r.value}-hint`} className="small muted rule-set-hint">{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="plan-preview" aria-live="polite">
          <p id="vehicle-limits" className="small">
            {vehicle ? (
              <>Limits per load: <b>{vehicleLimits(vehicle)}</b>. Dimensions without a limit are ignored.</>
            ) : <span className="muted">Choose a vehicle to see its limits.</span>}
          </p>
          {date && zone ? (
            batches.isPending ? <p className="small muted">Checking the batch…</p> : batch?.unplanned_orders ? (
              <p className="small">
                {formatDate(date)}, zone {zone}: <b>{batch.unplanned_orders} order{batch.unplanned_orders === 1 ? "" : "s"}</b> to plan
                ({sizeText(batch.total_weight_kg, batch.total_volume_m3, batch.total_pallet_spaces)})
                {estimate != null ? <>: at least <b>{estimate} load{estimate === 1 ? "" : "s"}</b> of this vehicle.</> : "."}
              </p>
            ) : (
              <p className="small warn-text">There are no accepted, unplanned orders for {formatDate(date)} in zone {zone}.</p>
            )
          ) : null}
        </div>

        <div className="form-actions">
          <button type="submit" className="primary" disabled={create.isPending || !zone || !vehicleId || !date}>
            {create.isPending ? "Starting…" : "▶ Run the optimiser"}
          </button>
        </div>

        <div role="alert">
          {infeasible ? (
            <div className="error infeasible">
              <p><b>⚠️ {infeasible.message}</b></p>
              {infeasible.misfits.length ? (
                <>
                  {infeasible.dg_issues?.length ? <h3 className="infeasible-h">Too big for {vehicle?.name ?? "the vehicle"}</h3> : null}
                  <ul>
                    {infeasible.misfits.map((m) => (
                      <li key={`${m.order_line_id}`}>
                        <Link to={`/ops/orders/${m.order_id}`}>{m.order_reference}</Link>: {m.message}
                        <span className="small"> (too big in {m.dimensions.map((d) => DIM_LABEL[d]).join(" and ")})</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {infeasible.dg_issues?.length ? (
                <>
                  <h3 className="infeasible-h">Dangerous goods Northline won't accept</h3>
                  <ul>
                    {byOrder(infeasible.dg_issues).map((g) => (
                      <li key={g.orderId}>
                        <Link to={`/ops/orders/${g.orderId}`}>{g.reference}</Link>
                        <ul>
                          {g.issues.map((i, k) => (
                            <li key={k}>
                              <b>{ISSUE_KIND[i.kind]}</b>{i.item_name ? <>: {i.item_name}</> : null}. {issueText(i)}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : create.error ? (
            <div className="error">⚠️ {errorMessage(create.error)}</div>
          ) : null}
        </div>
      </form>
    </>
  );
}
