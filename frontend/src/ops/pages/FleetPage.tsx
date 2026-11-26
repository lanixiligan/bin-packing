// /ops/fleet — Vehicles and drivers: create, edit, activate / deactivate.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, unwrap } from "../../api/client";
import { errorMessage } from "../../api/errors";
import { PageHeader } from "../../shell/AppShell";
import { Empty, QueryState } from "../../shell/QueryState";
import { useDrivers, useInvalidateOps, useVehicles, vehicleLimits, type Driver, type Vehicle } from "../queries";
import { LiveStatus } from "../ui";

export default function FleetPage() {
  const [message, setMessage] = useState("");
  return (
    <>
      <PageHeader title="Fleet" subtitle="Vehicles are the capacity profiles plans are packed against; each limit is optional, but every vehicle needs at least one." />
      <LiveStatus message={message} tone="good" />
      <VehiclesSection onMessage={setMessage} />
      <DriversSection onMessage={setMessage} />
    </>
  );
}

// ---- Vehicles ----------------------------------------------------------------------

function VehiclesSection({ onMessage }: { onMessage: (m: string) => void }) {
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Vehicle | "new" | null>(null);
  const vehicles = useVehicles(showInactive);
  const invalidate = useInvalidateOps();
  const toggle = useMutation({
    mutationFn: (v: Vehicle) =>
      unwrap(api.PATCH("/api/ops/vehicles/{vehicle_id}", { params: { path: { vehicle_id: v.id } }, body: { active: !v.active } })),
    onSuccess: (v) => onMessage(`${v.name} is now ${v.active ? "active" : "inactive"}.`),
    onSettled: () => void invalidate(),
  });

  return (
    <section className="card" aria-labelledby="vehicles-h">
      <div className="section-head">
        <h2 id="vehicles-h">Vehicles</h2>
        <label className="checkbox">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
        <button type="button" className="primary" onClick={() => setEditing("new")} disabled={editing === "new"}>Add vehicle</button>
      </div>
      {editing === "new" && (
        <VehicleForm onDone={(m) => { setEditing(null); if (m) onMessage(m); }} />
      )}
      {toggle.error ? <div className="error" role="alert">⚠️ {errorMessage(toggle.error)}</div> : null}
      <QueryState query={vehicles} loadingLabel="Loading vehicles…">
        {(list) =>
          !list.length ? <Empty>No vehicles yet.</Empty> : (
            <div className="table-wrap">
              <table className="table stack">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Registration</th>
                    <th scope="col" className="num">Max weight</th>
                    <th scope="col" className="num">Max volume</th>
                    <th scope="col" className="num">Max pallets</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((v) =>
                    editing !== "new" && editing?.id === v.id ? (
                      <tr key={v.id} className="editing-row">
                        <td colSpan={7}>
                          <VehicleForm vehicle={v} onDone={(m) => { setEditing(null); if (m) onMessage(m); }} />
                        </td>
                      </tr>
                    ) : (
                      <tr key={v.id} className={v.active ? "" : "inactive-row"}>
                        <td data-label="Name"><b>{v.name}</b></td>
                        <td data-label="Registration">{v.registration}</td>
                        <td data-label="Max weight" className="num">{v.max_weight_kg != null ? `${v.max_weight_kg.toLocaleString()} kg` : <NotLimited />}</td>
                        <td data-label="Max volume" className="num">{v.max_volume_m3 != null ? `${v.max_volume_m3.toLocaleString()} m³` : <NotLimited />}</td>
                        <td data-label="Max pallets" className="num">{v.max_pallets != null ? v.max_pallets : <NotLimited />}</td>
                        <td data-label="Status">{v.active ? "Active" : <span className="muted">Inactive</span>}</td>
                        <td data-label="Actions">
                          <div className="row-actions">
                            <button type="button" className="secondary" onClick={() => setEditing(v)}>Edit<span className="sr-only"> {v.name}</span></button>
                            <button type="button" className="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate(v)}>
                              {v.active ? "Deactivate" : "Activate"}<span className="sr-only"> {v.name}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryState>
    </section>
  );
}

const NotLimited = () => <span className="muted">not limited</span>;

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

function VehicleForm({ vehicle, onDone }: { vehicle?: Vehicle; onDone: (message?: string) => void }) {
  const invalidate = useInvalidateOps();
  const [name, setName] = useState(vehicle?.name ?? "");
  const [registration, setRegistration] = useState(vehicle?.registration ?? "");
  const [kg, setKg] = useState(vehicle?.max_weight_kg?.toString() ?? "");
  const [m3, setM3] = useState(vehicle?.max_volume_m3?.toString() ?? "");
  const [pallets, setPallets] = useState(vehicle?.max_pallets?.toString() ?? "");
  const [checked, setChecked] = useState(false);
  const noLimit = !kg.trim() && !m3.trim() && !pallets.trim();
  const prefix = vehicle ? `veh-${vehicle.id}` : "veh-new";

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        registration: registration.trim(),
        max_weight_kg: numOrNull(kg),
        max_volume_m3: numOrNull(m3),
        max_pallets: numOrNull(pallets),
      };
      return vehicle
        ? unwrap(api.PATCH("/api/ops/vehicles/{vehicle_id}", { params: { path: { vehicle_id: vehicle.id } }, body }))
        : unwrap(api.POST("/api/ops/vehicles", { body: { ...body, active: true } }));
    },
    onSuccess: (v) => {
      void invalidate();
      onDone(vehicle ? `Saved ${v.name}.` : `Added ${v.name} (${vehicleLimits(v)}).`);
    },
  });

  return (
    <form
      className="subform"
      aria-label={vehicle ? `Edit ${vehicle.name}` : "Add a vehicle"}
      onSubmit={(e) => {
        e.preventDefault();
        setChecked(true);
        if (!noLimit) save.mutate();
      }}
    >
      <h3>{vehicle ? `Edit ${vehicle.name}` : "Add a vehicle"}</h3>
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input value={name} required maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Registration</span>
          <input value={registration} required maxLength={20} onChange={(e) => setRegistration(e.target.value.toUpperCase())} />
        </label>
      </div>
      <fieldset className="capacity-fieldset" aria-describedby={`${prefix}-cap-hint${checked && noLimit ? ` ${prefix}-cap-err` : ""}`}>
        <legend>Capacity</legend>
        <p id={`${prefix}-cap-hint`} className="hint small muted">Leave a limit empty if the vehicle isn't limited in it. Set at least one.</p>
        <div className="form-grid">
          <label className="field">
            <span>Max weight (kg)</span>
            <input type="number" min="0.1" max="100000" step="any" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} aria-invalid={checked && noLimit ? true : undefined} />
          </label>
          <label className="field">
            <span>Max volume (m³)</span>
            <input type="number" min="0.01" max="1000" step="any" inputMode="decimal" value={m3} onChange={(e) => setM3(e.target.value)} aria-invalid={checked && noLimit ? true : undefined} />
          </label>
          <label className="field">
            <span>Max pallets</span>
            <input type="number" min="1" max="100" step="1" inputMode="numeric" value={pallets} onChange={(e) => setPallets(e.target.value)} aria-invalid={checked && noLimit ? true : undefined} />
          </label>
        </div>
        {checked && noLimit ? <p id={`${prefix}-cap-err`} className="field-error" role="alert">Set at least one capacity: weight, volume or pallets.</p> : null}
      </fieldset>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : vehicle ? "Save vehicle" : "Add vehicle"}</button>
        <button type="button" className="secondary" onClick={() => onDone()}>Cancel</button>
      </div>
      {save.error ? <div className="error" role="alert">⚠️ {errorMessage(save.error)}</div> : null}
    </form>
  );
}

// ---- Drivers ---------------------------------------------------------------------------

function DriversSection({ onMessage }: { onMessage: (m: string) => void }) {
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Driver | "new" | null>(null);
  const drivers = useDrivers(showInactive);
  const invalidate = useInvalidateOps();
  const toggle = useMutation({
    mutationFn: (d: Driver) =>
      unwrap(api.PATCH("/api/ops/drivers/{driver_id}", { params: { path: { driver_id: d.id } }, body: { active: !d.active } })),
    onSuccess: (d) => onMessage(`${d.name} is now ${d.active ? "active" : "inactive (they can't log in)"}.`),
    onSettled: () => void invalidate(),
  });

  return (
    <section className="card" aria-labelledby="drivers-h">
      <div className="section-head">
        <h2 id="drivers-h">Drivers</h2>
        <label className="checkbox">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
        <button type="button" className="primary" onClick={() => setEditing("new")} disabled={editing === "new"}>Add driver</button>
      </div>
      {editing === "new" && <DriverForm onDone={(m) => { setEditing(null); if (m) onMessage(m); }} />}
      {toggle.error ? <div className="error" role="alert">⚠️ {errorMessage(toggle.error)}</div> : null}
      <QueryState query={drivers} loadingLabel="Loading drivers…">
        {(list) =>
          !list.length ? <Empty>No drivers yet.</Empty> : (
            <div className="table-wrap">
              <table className="table stack">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">E-mail (login)</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Licence</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((d) =>
                    editing !== "new" && editing?.id === d.id ? (
                      <tr key={d.id} className="editing-row">
                        <td colSpan={6}><DriverForm driver={d} onDone={(m) => { setEditing(null); if (m) onMessage(m); }} /></td>
                      </tr>
                    ) : (
                      <tr key={d.id} className={d.active ? "" : "inactive-row"}>
                        <td data-label="Name"><b>{d.name}</b></td>
                        <td data-label="E-mail">{d.email}</td>
                        <td data-label="Phone">{d.phone ? <a href={`tel:${d.phone.replace(/\s+/g, "")}`}>{d.phone}</a> : <span className="muted">—</span>}</td>
                        <td data-label="Licence">{d.licence_number ?? <span className="muted">—</span>}</td>
                        <td data-label="Status">{d.active ? "Active" : <span className="muted">Inactive</span>}</td>
                        <td data-label="Actions">
                          <div className="row-actions">
                            <button type="button" className="secondary" onClick={() => setEditing(d)}>Edit<span className="sr-only"> {d.name}</span></button>
                            <button type="button" className="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate(d)}>
                              {d.active ? "Deactivate" : "Activate"}<span className="sr-only"> {d.name}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryState>
    </section>
  );
}

function DriverForm({ driver, onDone }: { driver?: Driver; onDone: (message?: string) => void }) {
  const invalidate = useInvalidateOps();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [licence, setLicence] = useState(driver?.licence_number ?? "");
  const save = useMutation({
    mutationFn: () => {
      const common = { name: name.trim(), phone: phone.trim() || null, licence_number: licence.trim() || null };
      return driver
        ? unwrap(api.PATCH("/api/ops/drivers/{driver_id}", { params: { path: { driver_id: driver.id } }, body: common }))
        : unwrap(api.POST("/api/ops/drivers", { body: { ...common, email: email.trim(), password } }));
    },
    onSuccess: (d) => {
      void invalidate();
      onDone(driver ? `Saved ${d.name}.` : `Added ${d.name}. They can log in as ${d.email}.`);
    },
  });
  return (
    <form
      className="subform"
      aria-label={driver ? `Edit ${driver.name}` : "Add a driver"}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h3>{driver ? `Edit ${driver.name}` : "Add a driver"}</h3>
      <div className="form-grid">
        {!driver && (
          <>
            <label className="field">
              <span>E-mail <span className="hint">(their login)</span></span>
              <input type="email" autoComplete="off" required value={email} autoFocus onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Password <span className="hint">(at least 8 characters)</span></span>
              <input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </>
        )}
        <label className="field">
          <span>Name</span>
          <input required maxLength={200} value={name} autoFocus={!!driver} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Phone <span className="hint">(optional)</span></span>
          <input type="tel" maxLength={50} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span>Licence number <span className="hint">(optional)</span></span>
          <input maxLength={50} value={licence} onChange={(e) => setLicence(e.target.value)} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : driver ? "Save driver" : "Add driver"}</button>
        <button type="button" className="secondary" onClick={() => onDone()}>Cancel</button>
      </div>
      {save.error ? <div className="error" role="alert">⚠️ {errorMessage(save.error)}</div> : null}
    </form>
  );
}
