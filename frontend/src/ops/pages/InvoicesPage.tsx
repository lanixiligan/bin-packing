// /ops/invoices — Monthly invoices per customer (orders delivered in the
// month, priced from their quotes), with the lines and a CSV download.
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, downloadFile, unwrap, type Schemas } from "../../api/client";
import { errorMessage } from "../../api/errors";
import { PageHeader } from "../../shell/AppShell";
import { Empty, QueryState } from "../../shell/QueryState";
import { formatDateTime, formatKg, formatM3, formatMoney } from "../../shell/format";
import { monthIso } from "../format";
import { ZoneTag } from "../ui";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-11" → "November 2026". */
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthIso(new Date(y, m - 1 + by, 1));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function InvoicesPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("month") ?? "";
  const month = MONTH_RE.test(raw) ? raw : monthIso();
  const companyId = Number(params.get("company")) || null;

  const set = (next: { month?: string; company?: number | null }) => {
    const p = new URLSearchParams(params);
    if (next.month !== undefined) {
      p.set("month", next.month);
      p.delete("company");
    }
    if (next.company !== undefined) {
      if (next.company == null) p.delete("company");
      else p.set("company", String(next.company));
    }
    setParams(p, { replace: true });
  };

  const list = useQuery({
    queryKey: ["ops", "invoices", month],
    queryFn: () => unwrap(api.GET("/api/ops/invoices", { params: { query: { month } } })),
  });

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Each customer's orders delivered in a calendar month, priced from the quote stored when they were submitted."
      />
      <div className="toolbar card">
        <button type="button" className="secondary" onClick={() => set({ month: shiftMonth(month, -1) })}>
          ← <span className="sr-only">Previous month</span>
        </button>
        <label className="field">
          <span>Month</span>
          <input
            type="month"
            value={month}
            max={monthIso()}
            onChange={(e) => MONTH_RE.test(e.target.value) && set({ month: e.target.value })}
          />
        </label>
        <button type="button" className="secondary" onClick={() => set({ month: shiftMonth(month, 1) })}>
          <span className="sr-only">Next month</span> →
        </button>
        {month !== monthIso() ? (
          <button type="button" className="link-button" onClick={() => set({ month: monthIso() })}>This month</button>
        ) : null}
      </div>

      <section className="card" aria-labelledby="invoices-h">
        <h2 id="invoices-h">{monthLabel(month)}</h2>
        <QueryState query={list} loadingLabel="Loading invoices…">
          {(rows) => !rows.length ? (
            <Empty>No orders were delivered in {monthLabel(month)}.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table stack">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col" className="num">Orders delivered</th>
                    <th scope="col" className="num">Total</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((inv) => (
                    <tr key={inv.company_id} className={inv.company_id === companyId ? "selected-row" : undefined}>
                      <td data-label="Customer"><b>{inv.company_name}</b></td>
                      <td data-label="Orders delivered" className="num">{inv.order_count}</td>
                      <td data-label="Total" className="num">{formatMoney(inv.total_amount)}</td>
                      <td data-label="Actions">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="secondary"
                            aria-pressed={inv.company_id === companyId}
                            onClick={() => set({ company: inv.company_id === companyId ? null : inv.company_id })}
                          >
                            {inv.company_id === companyId ? "Hide lines" : "View lines"}
                            <span className="sr-only"> for {inv.company_name}</span>
                          </button>
                          <CsvButton invoice={inv} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">All customers</th>
                    <td className="num" data-label="Orders delivered">{rows.reduce((s, r) => s + r.order_count, 0)}</td>
                    <td className="num" data-label="Total">
                      <b>{formatMoney(rows.reduce((s, r) => s + Number(r.total_amount), 0).toFixed(2))}</b>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </QueryState>
      </section>

      {companyId != null ? <InvoiceDetail companyId={companyId} month={month} /> : null}
    </>
  );
}

function CsvButton({ invoice }: { invoice: Pick<Schemas["InvoiceSummary"], "company_id" | "company_name" | "month"> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await downloadFile(
              `/api/ops/invoices/${invoice.company_id}/csv?month=${encodeURIComponent(invoice.month)}`,
              `invoice-${slug(invoice.company_name)}-${invoice.month}.csv`,
            );
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Downloading…" : "Download CSV"}
        <span className="sr-only"> for {invoice.company_name}, {monthLabel(invoice.month)}</span>
      </button>
      {error ? <span className="field-error" role="alert">{errorMessage(error)}</span> : null}
    </>
  );
}

function InvoiceDetail({ companyId, month }: { companyId: number; month: string }) {
  const query = useQuery({
    queryKey: ["ops", "invoice", companyId, month],
    queryFn: () => unwrap(api.GET("/api/ops/invoices/{company_id}", { params: { path: { company_id: companyId }, query: { month } } })),
  });
  return (
    <section className="card" aria-labelledby="invoice-h">
      <QueryState query={query} loadingLabel="Loading the invoice…">
        {(inv) => (
          <>
            <div className="section-head">
              <h2 id="invoice-h">{inv.company_name}: {monthLabel(inv.month)}</h2>
              <CsvButton invoice={inv} />
            </div>
            {!inv.lines.length ? <Empty>No deliveries this month.</Empty> : (
              <div className="table-wrap">
                <table className="table stack">
                  <caption className="sr-only">Delivered orders of {inv.company_name} in {monthLabel(inv.month)}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Delivered</th>
                      <th scope="col">Suburb</th>
                      <th scope="col">Zone</th>
                      <th scope="col" className="num">Weight</th>
                      <th scope="col" className="num">Volume</th>
                      <th scope="col" className="num">Cubic weight</th>
                      <th scope="col" className="num">Rate per kg</th>
                      <th scope="col" className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((l) => (
                      <tr key={l.order_id}>
                        <td data-label="Order">
                          <Link to={`/ops/orders/${l.order_id}`}><b>{l.reference}</b></Link>
                          {l.customer_reference ? <div className="small muted">{l.customer_reference}</div> : null}
                        </td>
                        <td data-label="Delivered">{formatDateTime(l.delivered_at)}</td>
                        <td data-label="Suburb">{l.delivery_suburb}</td>
                        <td data-label="Zone"><ZoneTag zone={l.zone_code} /></td>
                        <td data-label="Weight" className="num">{formatKg(l.total_weight_kg)}</td>
                        <td data-label="Volume" className="num">{formatM3(l.total_volume_m3)}</td>
                        <td data-label="Cubic weight" className="num">{formatKg(l.cubic_weight_kg)}</td>
                        <td data-label="Rate per kg" className="num">{formatMoney(l.rate_per_kg)}</td>
                        <td data-label="Amount" className="num">{formatMoney(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={8}>Total ({inv.order_count} order{inv.order_count === 1 ? "" : "s"})</th>
                      <td className="num" data-label="Total"><b>{formatMoney(inv.total_amount)}</b></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
