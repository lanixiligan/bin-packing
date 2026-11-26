// The order builder, used by /portal/orders/new and /portal/orders/:id/edit:
// addresses, date and window, item lines, live totals and a debounced quote
// preview, then "Save draft" or "Submit".
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, unwrap } from "../api/client";
import { ApiError } from "../api/errors";
import { ErrorBox, Loading } from "../shell/QueryState";
import { formatDateTime, formatKg, formatMoney, todayIso } from "../shell/format";
import { ErrorSummary, Field } from "./components/Field";
import { Notice, QuoteDetails, TotalsRow, ZoneNote } from "./components/OrderParts";
import {
  formatVolume, lineTotals, orNull, pricedLines, splitApiErrors, timeInput, validateOrder,
  type BuilderLine, type FieldErrors, type OrderFormValues,
} from "./logic";
import { useAddresses, useItems, useOrderSaved, useQuotePreview } from "./queries";
import type { Address, Item, Order, OrderCreate, QuotePreviewRequest } from "./types";

const ORDER_FIELDS = ["pickup_address_id", "delivery_address_id", "delivery_date", "window_start", "window_end", "customer_reference", "notes", "lines"];

let lineSeq = 0;
const newLine = (itemId = "", quantity = "1"): BuilderLine => ({ key: `l${++lineSeq}`, itemId, quantity });

function initialValues(order: Order | null, template: Order | null): OrderFormValues {
  const src = order ?? template;
  return {
    pickup_address_id: src ? String(src.pickup_address.id) : "",
    delivery_address_id: src ? String(src.delivery_address.id) : "",
    // A copied order gets a fresh date; a draft keeps its own.
    delivery_date: order ? order.delivery_date : todayIso(1),
    window_start: src ? timeInput(src.window_start) : "",
    window_end: src ? timeInput(src.window_end) : "",
    customer_reference: order?.customer_reference ?? "",
    notes: src?.notes ?? "",
    lines: src?.lines.length ? src.lines.map((l) => newLine(String(l.item_id), String(l.quantity))) : [newLine()],
  };
}

/** Value that follows `value` after it has been stable for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function OrderBuilder({ order = null, template = null, flash }: {
  /** The draft being edited, or null for a new order. */
  order?: Order | null;
  /** An order to copy (e.g. a rejected one), for a new order. */
  template?: Order | null;
  flash?: string | null;
}) {
  const items = useItems(true);
  const addresses = useAddresses(true);
  if (items.isPending || addresses.isPending) return <Loading label="Loading your items and addresses…" />;
  if (items.error || addresses.error) {
    return <ErrorBox error={items.error ?? addresses.error} onRetry={() => { void items.refetch(); void addresses.refetch(); }} />;
  }
  const activeAddresses = addresses.data.filter((a) => !a.archived);
  const activeItems = items.data.filter((i) => !i.archived);
  if (!order && (activeAddresses.length < 2 || activeItems.length === 0)) {
    return (
      <Notice tone="info" title="A few things are needed first">
        <ul>
          {activeAddresses.length < 2 ? <li>At least two addresses (a pickup and a delivery address): <Link to="/portal/addresses">add addresses</Link>.</li> : null}
          {activeItems.length === 0 ? <li>At least one item: <Link to="/portal/items">add items</Link>.</li> : null}
        </ul>
      </Notice>
    );
  }
  return <BuilderForm order={order} template={template} flash={flash ?? null} items={items.data} addresses={addresses.data} />;
}

function BuilderForm({ order, template, flash, items, addresses }: {
  order: Order | null;
  template: Order | null;
  flash: string | null;
  items: Item[];
  addresses: Address[];
}) {
  const uid = useId();
  const navigate = useNavigate();
  const orderSaved = useOrderSaved();
  const [v, setV] = useState<OrderFormValues>(() => initialValues(order, template));
  const [savedOrder, setSavedOrder] = useState<Order | null>(order);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [status, setStatus] = useState<string>(flash ?? "");
  const [apiError, setApiError] = useState<unknown>(null);
  const [serverFields, setServerFields] = useState<FieldErrors>({});
  const [serverGeneral, setServerGeneral] = useState<string[]>([]);
  const [focusLine, setFocusLine] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const today = todayIso();

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const addressById = useMemo(() => new Map(addresses.map((a) => [a.id, a])), [addresses]);
  const clientErrors = useMemo(() => validateOrder(v, today), [v, today]);
  const shown = (k: string) => (attempted ? clientErrors[k] : undefined) || serverFields[k] || undefined;

  const totals = lineTotals(v.lines.map((l) => ({ itemId: l.itemId ? Number(l.itemId) : null, quantity: Number(l.quantity) })), itemsById);

  // Live quote preview (debounced), once there's a delivery address and a complete line.
  const priced = pricedLines(v.lines);
  const quoteReq = v.delivery_address_id && priced.length ? { delivery_address_id: Number(v.delivery_address_id), lines: priced } : null;
  // Debounce the serialised request: a string compares by value, so re-renders don't restart the timer.
  const reqKey = JSON.stringify(quoteReq);
  const debouncedKey = useDebounced(reqKey, 400);
  const debouncedReq = useMemo(() => JSON.parse(debouncedKey) as QuotePreviewRequest | null, [debouncedKey]);
  const settled = debouncedKey === reqKey;
  const quote = useQuotePreview(debouncedReq);

  const update = (patch: Partial<OrderFormValues>) => {
    setV((prev) => ({ ...prev, ...patch }));
    const keys = Object.keys(patch);
    if (keys.some((k) => serverFields[k])) setServerFields((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k))));
  };
  const updateLine = (key: string, patch: Partial<BuilderLine>) => update({ lines: v.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const addLine = () => {
    const line = newLine();
    setFocusLine(line.key);
    update({ lines: [...v.lines, line] });
  };
  const removeLine = (key: string) => {
    update({ lines: v.lines.filter((l) => l.key !== key) });
    addButtonRef.current?.focus();
  };

  function body(): OrderCreate {
    return {
      pickup_address_id: Number(v.pickup_address_id),
      delivery_address_id: Number(v.delivery_address_id),
      delivery_date: v.delivery_date,
      window_start: v.window_start || null,
      window_end: v.window_end || null,
      customer_reference: orNull(v.customer_reference),
      notes: orNull(v.notes),
      lines: v.lines.map((l) => ({ item_id: Number(l.itemId), quantity: Number(l.quantity) })),
    };
  }

  async function saveDraft(): Promise<Order> {
    const b = body();
    const saved = savedOrder
      ? await unwrap(api.PATCH("/api/portal/orders/{order_id}", { params: { path: { order_id: savedOrder.id } }, body: b }))
      : await unwrap(api.POST("/api/portal/orders", { body: b }));
    setSavedOrder(saved);
    orderSaved(saved);
    return saved;
  }

  function showError(err: unknown) {
    setApiError(err);
    if (err instanceof ApiError && err.status === 422) {
      const split = splitApiErrors(err.detail, ORDER_FIELDS);
      setServerFields(split.fields);
      setServerGeneral(split.general.length || Object.keys(split.fields).length ? split.general : [err.message]);
    } else {
      setServerFields({});
      setServerGeneral([]);
    }
  }

  async function run(action: "save" | "submit") {
    setAttempted(true);
    setApiError(null);
    setServerFields({});
    setServerGeneral([]);
    setStatus("");
    if (Object.keys(clientErrors).length) return;
    setBusy(action);
    let saved: Order | null = null;
    try {
      saved = await saveDraft();
      if (action === "save") {
        if (!order) {
          navigate(`/portal/orders/${saved.id}/edit`, { replace: true, state: { flash: `Draft ${saved.reference} saved.` } });
          return;
        }
        setStatus(`Draft saved at ${formatDateTime(saved.updated_at)}.`);
      } else {
        const submitted = await unwrap(api.POST("/api/portal/orders/{order_id}/submit", { params: { path: { order_id: saved.id } } }));
        orderSaved(submitted);
        const q = submitted.quote;
        navigate(`/portal/orders/${submitted.id}`, {
          state: {
            flash: `Order ${submitted.reference} submitted.${q ? ` Quoted price: ${formatMoney(q.amount)}${q.provisional ? " (provisional)" : ""}.` : ""} Dispatch will review it next.`,
          },
        });
        return;
      }
    } catch (err) {
      showError(err);
      if (saved && action === "submit") setStatus(`Saved as draft ${saved.reference}, but it couldn’t be submitted.`);
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run("submit");
  }

  const pickupAddrs = addresses.filter((a) => !a.archived || String(a.id) === v.pickup_address_id);
  const deliveryAddrs = addresses.filter((a) => !a.archived || String(a.id) === v.delivery_address_id);
  const delivery = v.delivery_address_id ? addressById.get(Number(v.delivery_address_id)) : undefined;
  const chosen = new Set(v.lines.map((l) => l.itemId).filter(Boolean));
  const errorCount = (attempted ? Object.keys(clientErrors).length : 0) + Object.keys(serverFields).length;
  const id = (k: string) => `${uid}-${k}`;
  const addressOption = (a: Address) => (
    <option key={a.id} value={a.id}>{a.label}, {a.suburb}{a.archived ? " (archived)" : ""}</option>
  );

  return (
    <form className="builder" onSubmit={onSubmit} noValidate>
      <div className="builder-main">
        <div role="status" aria-live="polite">
          {status ? <Notice tone="good">{status}</Notice> : null}
        </div>
        {attempted && (errorCount || serverGeneral.length) ? <ErrorSummary count={errorCount} messages={serverGeneral} /> : null}
        {apiError && !(apiError instanceof ApiError && apiError.status === 422) ? <ErrorBox error={apiError} /> : null}
        {template ? <Notice tone="info" title={`Copied from ${template.reference}`}>Check the date, window and lines, then submit it as a new order.</Notice> : null}

        <fieldset className="card">
          <legend className="card-title">Where and when</legend>
          <div className="form-grid">
            <Field id={id("pickup")} label="Pickup from" required error={shown("pickup_address_id")}>
              {(p) => (
                <select {...p} value={v.pickup_address_id} onChange={(e) => update({ pickup_address_id: e.target.value })}>
                  <option value="">Choose an address…</option>
                  {pickupAddrs.map(addressOption)}
                </select>
              )}
            </Field>
            <Field id={id("delivery")} label="Deliver to" required error={shown("delivery_address_id")}
                   hint={delivery ? <ZoneNote zone={delivery.zone} /> : "The delivery address’s zone sets the price."}>
              {(p) => (
                <select {...p} value={v.delivery_address_id} onChange={(e) => update({ delivery_address_id: e.target.value })}>
                  <option value="">Choose an address…</option>
                  {deliveryAddrs.map((a) => (String(a.id) === v.pickup_address_id ? (
                    <option key={a.id} value={a.id} disabled>{a.label}, {a.suburb} (pickup)</option>
                  ) : addressOption(a)))}
                </select>
              )}
            </Field>
            <Field id={id("date")} label="Delivery date" required error={shown("delivery_date")}>
              {(p) => <input {...p} type="date" min={today} value={v.delivery_date} onChange={(e) => update({ delivery_date: e.target.value })} />}
            </Field>
            <div className="field window-field">
              <span className="field-label" id={id("window-label")}>Delivery window <span className="muted small">(optional)</span></span>
              <div className="window-inputs" role="group" aria-labelledby={id("window-label")}>
                <label className="visually-hidden" htmlFor={id("ws")}>Window from</label>
                <input id={id("ws")} type="time" value={v.window_start} aria-invalid={shown("window_start") ? true : undefined}
                       onChange={(e) => update({ window_start: e.target.value })} />
                <span aria-hidden="true">to</span>
                <label className="visually-hidden" htmlFor={id("we")}>Window to</label>
                <input id={id("we")} type="time" value={v.window_end} aria-invalid={shown("window_end") ? true : undefined}
                       aria-describedby={shown("window_end") ? id("we-error") : undefined}
                       onChange={(e) => update({ window_end: e.target.value })} />
              </div>
              {shown("window_end") || shown("window_start") ? (
                <span className="field-error" id={id("we-error")}>{shown("window_end") ?? shown("window_start")}</span>
              ) : (
                <span className="hint">Leave empty for any time.</span>
              )}
            </div>
          </div>
        </fieldset>

        <fieldset className="card">
          <legend className="card-title">Items</legend>
          {shown("lines") ? <p className="field-error" role="alert">{shown("lines")}</p> : null}
          <ol className="lines">
            {v.lines.map((line, idx) => {
              const item = line.itemId ? itemsById.get(Number(line.itemId)) : undefined;
              const qty = Number(line.quantity);
              const lineErr = (attempted ? clientErrors[`line:${line.key}`] : undefined) ?? undefined;
              const qtyInvalid = Boolean(lineErr?.startsWith("Quantity"));
              const itemInvalid = Boolean(lineErr) && !qtyInvalid;
              const options = items.filter((i) => String(i.id) === line.itemId || (!i.archived && !chosen.has(String(i.id))));
              return (
                <li key={line.key} className={`line-row${lineErr ? " has-error" : ""}`}>
                  <div className="field line-item">
                    <label htmlFor={id(`item-${line.key}`)}>Item {idx + 1}</label>
                    <select id={id(`item-${line.key}`)} value={line.itemId} autoFocus={focusLine === line.key}
                            aria-invalid={itemInvalid || undefined} aria-describedby={lineErr ? id(`err-${line.key}`) : undefined}
                            onChange={(e) => updateLine(line.key, { itemId: e.target.value })}>
                      <option value="">Choose an item…</option>
                      {options.map((i) => (
                        <option key={i.id} value={i.id}>{i.sku}: {i.name}{i.archived ? " (archived)" : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field line-qty">
                    <label htmlFor={id(`qty-${line.key}`)}>Quantity</label>
                    <input id={id(`qty-${line.key}`)} type="number" inputMode="numeric" min={1} max={10000} step={1} value={line.quantity}
                           aria-invalid={qtyInvalid || undefined} aria-describedby={lineErr ? id(`err-${line.key}`) : undefined}
                           onChange={(e) => updateLine(line.key, { quantity: e.target.value })} />
                  </div>
                  <p className="line-sub small muted">
                    {item && qty > 0 ? `${formatKg(item.weight_kg * qty)} · ${formatVolume(item.volume_m3 * qty)}` : null}
                  </p>
                  <button type="button" className="secondary line-remove" disabled={v.lines.length === 1}
                          aria-label={`Remove item ${idx + 1}${item ? ` (${item.sku})` : ""}`} onClick={() => removeLine(line.key)}>
                    Remove
                  </button>
                  {item?.archived ? <p className="line-error small">{item.sku} is archived: replace it with another item.</p> : null}
                  {lineErr ? <p className="line-error field-error" id={id(`err-${line.key}`)}>{lineErr}</p> : null}
                </li>
              );
            })}
          </ol>
          <button ref={addButtonRef} type="button" className="secondary" onClick={addLine}
                  disabled={v.lines.length >= 100 || items.filter((i) => !i.archived && !chosen.has(String(i.id))).length === 0}>
            + Add another item
          </button>
        </fieldset>

        <fieldset className="card">
          <legend className="card-title">References</legend>
          <div className="form-grid">
            <Field id={id("ref")} label="Your reference" error={shown("customer_reference")} hint="e.g. your PO number (shown on the invoice).">
              {(p) => <input {...p} value={v.customer_reference} maxLength={64} onChange={(e) => update({ customer_reference: e.target.value })} />}
            </Field>
            <Field id={id("notes")} label="Notes for dispatch" error={shown("notes")} className="span-2">
              {(p) => <textarea {...p} rows={3} value={v.notes} maxLength={1000} onChange={(e) => update({ notes: e.target.value })} />}
            </Field>
          </div>
        </fieldset>
      </div>

      <aside className="builder-side" aria-label="Order summary">
        <section className="card">
          <h2 className="card-title">Summary</h2>
          <TotalsRow totals={totals} />
          <div className="quote-preview" role="status" aria-live="polite" aria-busy={quote.isFetching || !settled}>
            {!quoteReq ? (
              <p className="muted small">Choose a delivery address and at least one item to see a price.</p>
            ) : quote.error ? (
              <ErrorBox error={quote.error} onRetry={() => void quote.refetch()} />
            ) : quote.data ? (
              <>
                <QuoteDetails quote={quote.data} stored={false} />
                {quote.isFetching || !settled ? <p className="small muted"><span className="spinner" aria-hidden="true" /> Updating the price…</p> : null}
              </>
            ) : (
              <p className="small muted"><span className="spinner" aria-hidden="true" /> Working out the price…</p>
            )}
            {quoteReq ? <p className="small muted">The price is fixed when you submit.</p> : null}
          </div>
          <div className="form-actions builder-actions">
            <button type="submit" className="primary" disabled={busy !== null}>
              {busy === "submit" ? "Submitting…" : "Submit order"}
            </button>
            <button type="button" className="secondary" disabled={busy !== null} onClick={() => void run("save")}>
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            {savedOrder ? <Link to={`/portal/orders/${savedOrder.id}`} className="button-link">View order</Link> : null}
          </div>
          {savedOrder ? <p className="small muted">Editing draft {savedOrder.reference}.</p> : null}
        </section>
      </aside>
    </form>
  );
}
