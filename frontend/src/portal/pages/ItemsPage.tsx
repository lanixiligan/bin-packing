// /portal/items: the item catalogue (weight, volume, pallet spaces, dangerous
// goods) with search, an archived toggle, create/edit and archive.
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../../api/client";
import { ApiError } from "../../api/errors";
import { PageHeader } from "../../shell/AppShell";
import { Empty, ErrorBox, QueryState } from "../../shell/QueryState";
import { formatKg, formatPallets } from "../../shell/format";
import { DgBadge } from "../../dg/DgBadge";
import { ConfirmButton } from "../components/ConfirmButton";
import { DgFields } from "../components/DgFields";
import { ErrorSummary, Field } from "../components/Field";
import { Notice } from "../components/OrderParts";
import {
  DG_FIELDS, dgFromForm, dgToForm, formatVolume, matchesItemSearch, orNull, splitApiErrors, validateItem, volumeFromCm,
  type DgFormValues, type FieldErrors, type ItemFormValues,
} from "../logic";
import { useItems } from "../queries";
import type { Item, ItemCreate } from "../types";

const ITEM_FIELDS = ["sku", "name", "description", "weight_kg", "volume_m3", "pallet_spaces", ...DG_FIELDS];

export default function ItemsPage() {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [message, setMessage] = useState("");
  const query = useItems(showArchived);
  const qc = useQueryClient();

  const archive = useMutation({
    mutationFn: (item: Item) => unwrap(api.DELETE("/api/portal/items/{item_id}", { params: { path: { item_id: item.id } } })),
    onSuccess: (_d, item) => {
      setMessage(`Archived ${item.sku}. It can no longer be added to orders.`);
      if (editing !== "new" && editing?.id === item.id) setEditing(null);
      void qc.invalidateQueries({ queryKey: ["portal", "items"] });
    },
  });

  const formOpen = editing !== null;
  return (
    <>
      <PageHeader
        title="Item catalogue"
        subtitle="The goods you ship. Weights and sizes are per unit and are used for pricing and planning."
        actions={!formOpen ? <button type="button" className="primary" onClick={() => { setMessage(""); setEditing("new"); }}>Add item</button> : null}
      />

      <div role="status" aria-live="polite">{message ? <Notice tone="good">{message}</Notice> : null}</div>

      {formOpen ? (
        <ItemForm
          key={editing === "new" ? "new" : editing.id}
          item={editing === "new" ? null : editing}
          onDone={(saved, created) => {
            setEditing(null);
            if (saved) setMessage(created ? `Added ${saved.sku}.` : `Saved ${saved.sku}.`);
          }}
        />
      ) : null}

      <section className="card" aria-labelledby="items-list-h">
        <h2 id="items-list-h" className="card-title">Items</h2>
        <div className="toolbar">
          <div className="field grow">
            <label htmlFor="item-search">Search</label>
            <input id="item-search" type="search" placeholder="SKU, name, description, DG class or UN number" value={search}
                   onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
        {archive.error ? <ErrorBox error={archive.error} /> : null}
        <QueryState query={query} loadingLabel="Loading items…">
          {(items) => {
            const rows = items.filter((i) => matchesItemSearch(i, search));
            if (items.length === 0) return <Empty>No items yet. Add the goods you ship to start building orders.</Empty>;
            if (rows.length === 0) return <Empty>No items match “{search}”.</Empty>;
            return (
              <>
                <p className="muted small" aria-live="polite">{rows.length} of {items.length} item{items.length === 1 ? "" : "s"}</p>
                <div className="table-wrap">
                  <table className="table stack">
                    <thead>
                      <tr>
                        <th scope="col">SKU</th>
                        <th scope="col">Name</th>
                        <th scope="col" className="num">Weight</th>
                        <th scope="col" className="num">Volume</th>
                        <th scope="col" className="num">Pallets</th>
                        <th scope="col"><abbr title="Dangerous goods">DG</abbr></th>
                        <th scope="col"><span className="visually-hidden">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((item) => (
                        <tr key={item.id} className={item.archived ? "row-archived" : undefined}>
                          <td data-label="SKU"><code>{item.sku}</code></td>
                          <td data-label="Name">
                            <span>
                              {item.name}
                              {item.archived ? <span className="chip chip-archived">Archived</span> : null}
                              {item.description ? <span className="cell-sub muted small">{item.description}</span> : null}
                            </span>
                          </td>
                          <td data-label="Weight" className="num">{formatKg(item.weight_kg)}</td>
                          <td data-label="Volume" className="num">{formatVolume(item.volume_m3)}</td>
                          <td data-label="Pallets" className="num">{formatPallets(item.pallet_spaces)}</td>
                          <td data-label="Dangerous goods"><DgBadge dg={item.dg} showUn showGeneral /></td>
                          <td data-label="Actions" className="row-actions">
                            <span className="actions-inline">
                              <button type="button" className="secondary" aria-label={`Edit ${item.sku}`}
                                      onClick={() => { setMessage(""); setEditing(item); }}>
                                Edit
                              </button>
                              {!item.archived ? (
                                <ConfirmButton
                                  label="Archive"
                                  accessibleLabel={`Archive ${item.sku}`}
                                  question={`Archive ${item.sku}?`}
                                  confirmLabel="Yes, archive"
                                  busy={archive.isPending && archive.variables?.id === item.id}
                                  onConfirm={() => archive.mutate(item)}
                                />
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          }}
        </QueryState>
      </section>
    </>
  );
}

const toValues = (item: Item | null): ItemFormValues => ({
  sku: item?.sku ?? "",
  name: item?.name ?? "",
  description: item?.description ?? "",
  weight_kg: item ? String(item.weight_kg) : "",
  volume_m3: item ? String(item.volume_m3) : "",
  pallet_spaces: item ? String(item.pallet_spaces) : "",
  dg: dgToForm(item?.dg),
});

function ItemForm({ item, onDone }: { item: Item | null; onDone: (saved: Item | null, created: boolean) => void }) {
  const uid = useId();
  const qc = useQueryClient();
  const [v, setV] = useState<ItemFormValues>(() => toValues(item));
  const [dims, setDims] = useState({ l: "", w: "", h: "" });
  const [dimsNote, setDimsNote] = useState("");
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [serverErrors, setServerErrors] = useState<{ fields: FieldErrors; general: string[] }>({ fields: {}, general: [] });
  const [attempted, setAttempted] = useState(false);

  const save = useMutation({
    mutationFn: (body: ItemCreate) =>
      item
        ? unwrap(api.PATCH("/api/portal/items/{item_id}", { params: { path: { item_id: item.id } }, body }))
        : unwrap(api.POST("/api/portal/items", { body })),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["portal", "items"] });
      onDone(saved, !item);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setServerErrors({ fields: { sku: err.message || "This SKU is already used by another item." }, general: [] });
      } else if (err instanceof ApiError && err.status === 422) {
        const split = splitApiErrors(err.detail, ITEM_FIELDS);
        setServerErrors({ fields: split.fields, general: split.general.length || Object.keys(split.fields).length ? split.general : [err.message] });
      } else {
        setServerErrors({ fields: {}, general: [] });
      }
    },
  });

  const set = (key: Exclude<keyof ItemFormValues, "dg">, value: string) => {
    const next = { ...v, [key]: value };
    setV(next);
    if (attempted) setClientErrors(validateItem(next));
    if (serverErrors.fields[key]) setServerErrors((s) => ({ ...s, fields: { ...s.fields, [key]: "" } }));
  };

  const setDg = (patch: Partial<DgFormValues>) => {
    const next = { ...v, dg: { ...v.dg, ...patch } };
    setV(next);
    if (attempted) setClientErrors(validateItem(next));
    if (DG_FIELDS.some((k) => serverErrors.fields[k])) {
      setServerErrors((s) => ({ ...s, fields: Object.fromEntries(Object.entries(s.fields).filter(([k]) => !DG_FIELDS.includes(k))) }));
    }
  };

  const setDim = (key: "l" | "w" | "h", value: string) => {
    const next = { ...dims, [key]: value };
    setDims(next);
    const m3 = volumeFromCm(next.l, next.w, next.h);
    if (m3 != null) {
      set("volume_m3", String(m3));
      setDimsNote(`Volume set to ${m3} m³ from ${next.l} × ${next.w} × ${next.h} cm.`);
    } else {
      setDimsNote("");
    }
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    const errs = validateItem(v);
    setClientErrors(errs);
    setServerErrors({ fields: {}, general: [] });
    if (Object.keys(errs).length) return;
    save.mutate({
      sku: v.sku.trim(),
      name: v.name.trim(),
      description: orNull(v.description),
      weight_kg: Number(v.weight_kg),
      volume_m3: v.volume_m3.trim() === "" ? 0 : Number(v.volume_m3),
      pallet_spaces: v.pallet_spaces.trim() === "" ? 0 : Number(v.pallet_spaces),
      dg: dgFromForm(v.dg),
    });
  }

  const err = (k: string) => clientErrors[k] || serverErrors.fields[k] || null;
  const errorCount = ITEM_FIELDS.filter((k) => err(k)).length;
  const id = (k: string) => `${uid}-${k}`;

  return (
    <section className="card form-card" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="card-title">{item ? `Edit ${item.sku}` : "Add an item"}</h2>
      {item?.archived ? <Notice tone="warn" title="This item is archived.">You can still correct its details; it can’t be added to new orders.</Notice> : null}
      <form onSubmit={submit} noValidate>
        {attempted || serverErrors.general.length ? <ErrorSummary count={errorCount} messages={serverErrors.general} /> : null}
        {save.error && !(save.error instanceof ApiError && (save.error.status === 409 || save.error.status === 422)) ? <ErrorBox error={save.error} /> : null}
        <div className="form-grid">
          <Field id={id("sku")} label="SKU" required error={err("sku")} hint="Your own product code. Must be unique.">
            {(p) => <input {...p} autoFocus value={v.sku} maxLength={64} autoComplete="off" onChange={(e) => set("sku", e.target.value)} />}
          </Field>
          <Field id={id("name")} label="Name" required error={err("name")} className="span-2">
            {(p) => <input {...p} value={v.name} maxLength={200} onChange={(e) => set("name", e.target.value)} />}
          </Field>
          <Field id={id("description")} label="Description" error={err("description")} className="span-full">
            {(p) => <textarea {...p} rows={2} value={v.description} maxLength={1000} onChange={(e) => set("description", e.target.value)} />}
          </Field>
          <Field id={id("weight_kg")} label="Weight per unit (kg)" required error={err("weight_kg")}>
            {(p) => <input {...p} type="number" inputMode="decimal" min="0" step="any" value={v.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} />}
          </Field>
          <Field id={id("volume_m3")} label="Volume per unit (m³)" error={err("volume_m3")} hint="Leave empty for 0, or calculate it below.">
            {(p) => <input {...p} type="number" inputMode="decimal" min="0" step="any" value={v.volume_m3} onChange={(e) => set("volume_m3", e.target.value)} />}
          </Field>
          <Field id={id("pallet_spaces")} label="Pallet spaces per unit" error={err("pallet_spaces")} hint="e.g. 1 for a full pallet, 0 for loose goods.">
            {(p) => <input {...p} type="number" inputMode="decimal" min="0" step="any" value={v.pallet_spaces} onChange={(e) => set("pallet_spaces", e.target.value)} />}
          </Field>
        </div>

        <details className="dims-helper">
          <summary>Calculate the volume from length × width × height (cm)</summary>
          <div className="dims-row">
            {(["l", "w", "h"] as const).map((k) => (
              <div className="field" key={k}>
                <label htmlFor={id(`dim-${k}`)}>{{ l: "Length", w: "Width", h: "Height" }[k]} (cm)</label>
                <input id={id(`dim-${k}`)} type="number" inputMode="decimal" min="0" step="any" value={dims[k]}
                       onChange={(e) => setDim(k, e.target.value)} />
              </div>
            ))}
          </div>
          <p className="small muted" role="status" aria-live="polite">{dimsNote || "Fill in all three sides to set the volume."}</p>
        </details>

        <DgFields idPrefix={uid} value={v.dg} onChange={setDg} err={err} />

        <div className="form-actions">
          <button type="submit" className="primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : item ? "Save changes" : "Add item"}
          </button>
          <button type="button" className="secondary" onClick={() => onDone(null, false)} disabled={save.isPending}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
