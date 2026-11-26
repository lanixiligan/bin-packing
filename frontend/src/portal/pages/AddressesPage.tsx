// /portal/addresses: saved pickup and delivery addresses. The zone is set by
// dispatch and only shown here.
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../../api/client";
import { ApiError } from "../../api/errors";
import { PageHeader } from "../../shell/AppShell";
import { Empty, ErrorBox, QueryState } from "../../shell/QueryState";
import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorSummary, Field } from "../components/Field";
import { AddressBlock, Notice, ZoneNote } from "../components/OrderParts";
import { orNull, splitApiErrors, validateAddress, type AddressFormValues, type FieldErrors } from "../logic";
import { useAddresses } from "../queries";
import type { Address, AddressCreate } from "../types";

const ADDRESS_FIELDS: (keyof AddressFormValues)[] = ["label", "contact_name", "phone", "line1", "line2", "suburb", "state", "postcode", "country", "notes"];

export default function AddressesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const [message, setMessage] = useState("");
  const query = useAddresses(showArchived);
  const qc = useQueryClient();

  const archive = useMutation({
    mutationFn: (a: Address) => unwrap(api.DELETE("/api/portal/addresses/{address_id}", { params: { path: { address_id: a.id } } })),
    onSuccess: (_d, a) => {
      setMessage(`Archived “${a.label}”. Existing orders keep it; new orders can’t use it.`);
      if (editing !== "new" && editing?.id === a.id) setEditing(null);
      void qc.invalidateQueries({ queryKey: ["portal", "addresses"] });
    },
  });

  return (
    <>
      <PageHeader
        title="Address book"
        subtitle="Pickup and delivery addresses. Dispatch assigns each address to a delivery zone, which sets the price per kg."
        actions={editing === null ? <button type="button" className="primary" onClick={() => { setMessage(""); setEditing("new"); }}>Add address</button> : null}
      />
      <div role="status" aria-live="polite">{message ? <Notice tone="good">{message}</Notice> : null}</div>

      {editing !== null ? (
        <AddressForm
          key={editing === "new" ? "new" : editing.id}
          address={editing === "new" ? null : editing}
          onDone={(saved, created) => {
            setEditing(null);
            if (saved) setMessage(created ? `Added “${saved.label}”.` : `Saved “${saved.label}”.`);
          }}
        />
      ) : null}

      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>
      {archive.error ? <ErrorBox error={archive.error} /> : null}

      <QueryState query={query} loadingLabel="Loading addresses…">
        {(addresses) =>
          addresses.length === 0 ? (
            <Empty>No addresses yet. Add your warehouse and your delivery sites to build orders.</Empty>
          ) : (
            <ul className="card-grid" aria-label="Addresses">
              {addresses.map((a) => (
                <li key={a.id} className={`card address-card${a.archived ? " row-archived" : ""}`}>
                  <AddressBlock address={a} />
                  <div className="actions-inline">
                    <button type="button" className="secondary" aria-label={`Edit ${a.label}`} onClick={() => { setMessage(""); setEditing(a); }}>Edit</button>
                    {!a.archived ? (
                      <ConfirmButton
                        label="Archive"
                        accessibleLabel={`Archive ${a.label}`}
                        question={`Archive “${a.label}”?`}
                        confirmLabel="Yes, archive"
                        busy={archive.isPending && archive.variables?.id === a.id}
                        onConfirm={() => archive.mutate(a)}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </>
  );
}

const toValues = (a: Address | null): AddressFormValues => ({
  label: a?.label ?? "",
  contact_name: a?.contact_name ?? "",
  phone: a?.phone ?? "",
  line1: a?.line1 ?? "",
  line2: a?.line2 ?? "",
  suburb: a?.suburb ?? "",
  state: a?.state ?? "NSW",
  postcode: a?.postcode ?? "",
  country: a?.country ?? "AU",
  notes: a?.notes ?? "",
});

function AddressForm({ address, onDone }: { address: Address | null; onDone: (saved: Address | null, created: boolean) => void }) {
  const uid = useId();
  const qc = useQueryClient();
  const [v, setV] = useState<AddressFormValues>(() => toValues(address));
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [serverErrors, setServerErrors] = useState<{ fields: FieldErrors; general: string[] }>({ fields: {}, general: [] });
  const [attempted, setAttempted] = useState(false);

  const save = useMutation({
    mutationFn: (body: AddressCreate) =>
      address
        ? unwrap(api.PATCH("/api/portal/addresses/{address_id}", { params: { path: { address_id: address.id } }, body }))
        : unwrap(api.POST("/api/portal/addresses", { body })),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["portal", "addresses"] });
      onDone(saved, !address);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const split = splitApiErrors(err.detail, ADDRESS_FIELDS);
        setServerErrors({ fields: split.fields, general: split.general.length || Object.keys(split.fields).length ? split.general : [err.message] });
      }
    },
  });

  const set = (key: keyof AddressFormValues, value: string) => {
    const next = { ...v, [key]: value };
    setV(next);
    if (attempted) setClientErrors(validateAddress(next));
    if (serverErrors.fields[key]) setServerErrors((s) => ({ ...s, fields: { ...s.fields, [key]: "" } }));
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    const errs = validateAddress(v);
    setClientErrors(errs);
    setServerErrors({ fields: {}, general: [] });
    if (Object.keys(errs).length) return;
    save.mutate({
      label: v.label.trim(),
      contact_name: orNull(v.contact_name),
      phone: orNull(v.phone),
      line1: v.line1.trim(),
      line2: orNull(v.line2),
      suburb: v.suburb.trim(),
      state: v.state.trim(),
      postcode: v.postcode.trim(),
      country: v.country.trim().toUpperCase(),
      notes: orNull(v.notes),
    });
  }

  const err = (k: string) => clientErrors[k] || serverErrors.fields[k] || null;
  const errorCount = ADDRESS_FIELDS.filter((k) => err(k)).length;
  const id = (k: string) => `${uid}-${k}`;
  const text = (k: keyof AddressFormValues, label: string, o: { required?: boolean; max: number; className?: string; autoComplete?: string; hint?: string; autoFocus?: boolean }) => (
    <Field id={id(k)} label={label} required={o.required} error={err(k)} className={o.className} hint={o.hint}>
      {(p) => <input {...p} value={v[k]} maxLength={o.max} autoComplete={o.autoComplete} autoFocus={o.autoFocus} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  );

  return (
    <section className="card form-card" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="card-title">{address ? `Edit “${address.label}”` : "Add an address"}</h2>
      {address ? (
        <p className="small"><ZoneNote zone={address.zone} /></p>
      ) : (
        <p className="small muted">New addresses are not zoned yet: prices to them are provisional until dispatch assigns a zone.</p>
      )}
      <form onSubmit={submit} noValidate>
        {attempted || serverErrors.general.length ? <ErrorSummary count={errorCount} messages={serverErrors.general} /> : null}
        {save.error && !(save.error instanceof ApiError && save.error.status === 422) ? <ErrorBox error={save.error} /> : null}
        <div className="form-grid">
          {text("label", "Label", { required: true, max: 100, hint: "A short name, e.g. “Botany warehouse”.", autoFocus: true })}
          {text("contact_name", "Contact name", { max: 200, autoComplete: "name" })}
          <Field id={id("phone")} label="Phone" error={err("phone")}>
            {(p) => <input {...p} type="tel" value={v.phone} maxLength={50} autoComplete="tel" onChange={(e) => set("phone", e.target.value)} />}
          </Field>
          {text("line1", "Street address", { required: true, max: 200, className: "span-2", autoComplete: "address-line1" })}
          {text("line2", "Address line 2", { max: 200, autoComplete: "address-line2", hint: "Unit, building, dock…" })}
          {text("suburb", "Suburb", { required: true, max: 100, autoComplete: "address-level2" })}
          {text("state", "State", { required: true, max: 50, autoComplete: "address-level1" })}
          <Field id={id("postcode")} label="Postcode" required error={err("postcode")}>
            {(p) => <input {...p} inputMode="numeric" value={v.postcode} maxLength={10} autoComplete="postal-code" onChange={(e) => set("postcode", e.target.value)} />}
          </Field>
          {text("country", "Country code", { required: true, max: 2, autoComplete: "country", hint: "Two letters, e.g. AU." })}
          <Field id={id("notes")} label="Delivery notes" error={err("notes")} className="span-full" hint="Access, opening hours, forklift on site…">
            {(p) => <textarea {...p} rows={2} value={v.notes} maxLength={1000} onChange={(e) => set("notes", e.target.value)} />}
          </Field>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : address ? "Save changes" : "Add address"}</button>
          <button type="button" className="secondary" disabled={save.isPending} onClick={() => onDone(null, false)}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
