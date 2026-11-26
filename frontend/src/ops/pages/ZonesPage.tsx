// /ops/zones — Zones and their rates; set the zone of customer addresses.
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";
import { errorMessage } from "../../api/errors";
import { PageHeader } from "../../shell/AppShell";
import { Empty, QueryState } from "../../shell/QueryState";
import { formatAddress, formatMoney } from "../../shell/format";
import { useCompanies, useInvalidateOps, useZones, type Zone } from "../queries";
import { LiveStatus, ZoneTag } from "../ui";

export default function ZonesPage() {
  const zones = useZones();
  return (
    <>
      <PageHeader title="Zones" subtitle="Orders are batched by delivery date and the zone of their delivery address. The zone's rate prices new quotes." />
      <section className="card" aria-labelledby="zones-h">
        <h2 id="zones-h">Zones and rates</h2>
        <QueryState query={zones} loadingLabel="Loading zones…">
          {(list) => <ZoneTable zones={list} />}
        </QueryState>
        <NewZoneForm />
      </section>
      <AddressesSection zones={zones.data ?? []} />
    </>
  );
}

function ZoneTable({ zones }: { zones: Zone[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  if (!zones.length) return <Empty>No zones yet. Add the first one below.</Empty>;
  return (
    <>
      <LiveStatus message={message} tone="good" />
      <div className="table-wrap">
        <table className="table stack">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col" className="num">Rate per kg</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) =>
              editing === z.code ? (
                <EditZoneRow key={z.code} zone={z} onDone={(m) => { setEditing(null); if (m) setMessage(m); }} />
              ) : (
                <tr key={z.code}>
                  <td data-label="Code"><b>{z.code}</b></td>
                  <td data-label="Name">{z.name}</td>
                  <td data-label="Rate per kg" className="num">{formatMoney(z.rate_per_kg)}</td>
                  <td data-label="Status">{z.active ? "Active" : <span className="muted">Inactive</span>}</td>
                  <td data-label="Actions">
                    <div className="row-actions">
                      <button type="button" className="secondary" onClick={() => setEditing(z.code)}>
                        Edit<span className="sr-only"> zone {z.code}</span>
                      </button>
                      <ToggleZone zone={z} onMessage={setMessage} />
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ToggleZone({ zone, onMessage }: { zone: Zone; onMessage: (m: string) => void }) {
  const invalidate = useInvalidateOps();
  const m = useMutation({
    mutationFn: () => unwrap(api.PATCH("/api/ops/zones/{code}", { params: { path: { code: zone.code } }, body: { active: !zone.active } })),
    onSuccess: (z) => onMessage(`Zone ${z.code} is now ${z.active ? "active" : "inactive"}.`),
    onSettled: () => void invalidate(),
  });
  return (
    <>
      <button type="button" className="secondary" disabled={m.isPending} onClick={() => m.mutate()}>
        {zone.active ? "Deactivate" : "Activate"}<span className="sr-only"> zone {zone.code}</span>
      </button>
      {m.error ? <span className="field-error" role="alert">{errorMessage(m.error)}</span> : null}
    </>
  );
}

function EditZoneRow({ zone, onDone }: { zone: Zone; onDone: (message?: string) => void }) {
  const invalidate = useInvalidateOps();
  const [name, setName] = useState(zone.name);
  const [rate, setRate] = useState(String(Number(zone.rate_per_kg)));
  const save = useMutation({
    mutationFn: () => unwrap(api.PATCH("/api/ops/zones/{code}", { params: { path: { code: zone.code } }, body: { name: name.trim(), rate_per_kg: rate } })),
    onSuccess: (z) => {
      void invalidate();
      onDone(`Saved zone ${z.code}.`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const formId = `zone-edit-${zone.code}`;
  return (
    <tr className="editing-row">
      <td data-label="Code"><b>{zone.code}</b></td>
      <td data-label="Name">
        <input form={formId} aria-label={`Name of zone ${zone.code}`} value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
      </td>
      <td data-label="Rate per kg" className="num">
        <input form={formId} aria-label={`Rate per kg for zone ${zone.code}, in dollars`} type="number" min="0.0001" step="0.0001" required value={rate} onChange={(e) => setRate(e.target.value)} className="num-input" />
      </td>
      <td data-label="Status">{zone.active ? "Active" : "Inactive"}</td>
      <td data-label="Actions">
        <form id={formId} onSubmit={submit} className="row-actions">
          <button type="submit" className="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button>
          <button type="button" className="secondary" onClick={() => onDone()}>Cancel</button>
        </form>
        {save.error ? <div className="field-error" role="alert">{errorMessage(save.error)}</div> : null}
      </td>
    </tr>
  );
}

function NewZoneForm() {
  const invalidate = useInvalidateOps();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const create = useMutation({
    mutationFn: () => unwrap(api.POST("/api/ops/zones", { body: { code: code.trim().toUpperCase(), name: name.trim(), rate_per_kg: rate } })),
    onSuccess: () => {
      setCode("");
      setName("");
      setRate("");
      void invalidate();
    },
  });
  return (
    <form
      className="subform"
      aria-labelledby="new-zone-h"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h3 id="new-zone-h">Add a zone</h3>
      <div className="form-grid">
        <label className="field">
          <span>Code <span className="hint">A–Z, 0–9, _ or -</span></span>
          <input value={code} required maxLength={32} pattern="[A-Za-z0-9_\-]{1,32}" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </label>
        <label className="field">
          <span>Name</span>
          <input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Rate per kg ($)</span>
          <input type="number" min="0.0001" step="0.0001" inputMode="decimal" required value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={create.isPending}>{create.isPending ? "Adding…" : "Add zone"}</button>
      </div>
      <div role="status">
        {create.isSuccess ? <p className="good-text">Zone {create.data.code} added.</p> : null}
      </div>
      {create.error ? <div className="error" role="alert">⚠️ {errorMessage(create.error)}</div> : null}
    </form>
  );
}

// ---- Addresses ------------------------------------------------------------------

function AddressesSection({ zones }: { zones: Zone[] }) {
  const [params, setParams] = useSearchParams();
  const filter = params.get("addresses") ?? "none"; // "none" = unzoned only, "" = all, or a zone code
  const companyId = params.get("company") ?? "";
  const companies = useCompanies();
  const query = useQuery({
    queryKey: ["ops", "addresses", { filter, companyId }],
    queryFn: () =>
      unwrap(api.GET("/api/ops/addresses", {
        params: { query: { zone: filter || undefined, company_id: companyId ? Number(companyId) : undefined } },
      })),
  });
  const [message, setMessage] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (!value && key === "company") next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <section className="card" aria-labelledby="addresses-h">
      <h2 id="addresses-h">Customer addresses</h2>
      <p className="muted small">Orders to an address without a zone can't be planned. Setting a zone doesn't change quotes that were already stored.</p>
      <div className="toolbar">
        <label className="field">
          <span>Show</span>
          <select value={filter} onChange={(e) => set("addresses", e.target.value)}>
            <option value="none">Addresses without a zone</option>
            <option value="">All addresses</option>
            {zones.map((z) => <option key={z.code} value={z.code}>Zone {z.code}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Company</span>
          <select value={companyId} onChange={(e) => set("company", e.target.value)}>
            <option value="">Any company</option>
            {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <LiveStatus message={message?.text} tone={message?.tone} />
      <QueryState query={query} loadingLabel="Loading addresses…">
        {(rows) => {
          if (!rows.length) {
            return <Empty>{filter === "none" ? "Every address has a zone. 🎉" : "No addresses match."}</Empty>;
          }
          // unzoned first, then by company and label
          const sorted = [...rows].sort((a, b) =>
            Number(a.zone != null) - Number(b.zone != null) || a.company_name.localeCompare(b.company_name) || a.label.localeCompare(b.label));
          return (
            <div className="table-wrap">
              <table className="table stack">
                <thead>
                  <tr>
                    <th scope="col">Company</th>
                    <th scope="col">Address</th>
                    <th scope="col">Zone</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Company">{a.company_name}</td>
                      <td data-label="Address"><b>{a.label}</b><div className="small muted">{formatAddress(a)}</div></td>
                      <td data-label="Zone"><AddressZoneSelect address={a} zones={zones} onMessage={setMessage} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}

function AddressZoneSelect({ address, zones, onMessage }: {
  address: Schemas["OpsAddressRead"];
  zones: Zone[];
  onMessage: (m: { text: string; tone: "good" | "bad" }) => void;
}) {
  const invalidate = useInvalidateOps();
  const m = useMutation({
    mutationFn: (zone: string | null) =>
      unwrap(api.PATCH("/api/ops/addresses/{address_id}", { params: { path: { address_id: address.id } }, body: { zone } })),
    onSuccess: (a) => onMessage({ text: a.zone ? `${a.label} is now in zone ${a.zone}.` : `${a.label} has no zone now.`, tone: "good" }),
    onError: (e) => onMessage({ text: `${address.label}: ${errorMessage(e)}`, tone: "bad" }),
    onSettled: () => void invalidate(),
  });
  // keep the inactive zone visible if the address still has it
  const options = zones.filter((z) => z.active || z.code === address.zone);
  return (
    <span className="zone-select">
      <select
        aria-label={`Zone for ${address.label} (${address.company_name})`}
        value={address.zone ?? ""}
        disabled={m.isPending}
        onChange={(e) => m.mutate(e.target.value || null)}
      >
        <option value="">No zone</option>
        {options.map((z) => <option key={z.code} value={z.code}>{z.code} · {z.name}</option>)}
      </select>
      {m.isPending ? <span className="small muted"> Saving…</span> : !address.zone ? <> <ZoneTag zone={null} /></> : null}
    </span>
  );
}
