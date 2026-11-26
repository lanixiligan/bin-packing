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

const isInfeasible = (d: unknown): d is Infeasible =>
  !!d && typeof d === "object" && "misfits" in d && Array.isArray((d as Infeasible).misfits);

const DIM_LABEL = { weight: "weight", volume: "volume", pallets: "pallets" } as const;

export default function PlanNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [date, setDate] = useState(params.get("date") ?? todayIso(1));
  const [zone, setZone] = useState(params.get("zone") ?? "");
  const [vehicleId, setVehicleId] = useState("");

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
      unwrap(api.POST("/api/ops/plans", { body: { delivery_date: date, zone, vehicle_id: Number(vehicleId) } })),
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
              <ul>
                {infeasible.misfits.map((m) => (
                  <li key={`${m.order_line_id}`}>
                    <Link to={`/ops/orders/${m.order_id}`}>{m.order_reference}</Link>: {m.message}
                    <span className="small"> (too big in {m.dimensions.map((d) => DIM_LABEL[d]).join(" and ")})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : create.error ? (
            <div className="error">⚠️ {errorMessage(create.error)}</div>
          ) : null}
        </div>
      </form>
    </>
  );
}
