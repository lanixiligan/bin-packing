// /driver/run — The driver's loads for a day (today by default), with the
// stops grouped as pickups, deliveries and done. Phone-first.
import { Link, useLocation, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";
import { PageHeader } from "../../shell/AppShell";
import { Empty, QueryState } from "../../shell/QueryState";
import { StatusChip } from "../../shell/StatusChip";
import { formatAddress, formatDate, formatWindow, todayIso } from "../../shell/format";
import { shiftDate } from "../../ops/format";
import { dgClassesText, itemCount, mapsUrl, plural, type DriverOrder } from "../util";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function RunPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const flash = (location.state as { message?: string } | null)?.message;
  const raw = params.get("date") ?? "";
  const date = DATE_RE.test(raw) ? raw : todayIso();
  const isToday = date === todayIso();

  const setDate = (d: string) => setParams(d === todayIso() ? {} : { date: d }, { replace: true });

  const run = useQuery({
    queryKey: ["driver", "run", date],
    queryFn: () => unwrap(api.GET("/api/driver/run", { params: { query: { date } } })),
    refetchOnWindowFocus: true,
  });

  return (
    <>
      <PageHeader title={isToday ? "Today's run" : "Run"} subtitle={formatDate(date)} />

      <nav className="day-nav" aria-label="Choose the day">
        <button type="button" className="tap-button secondary" onClick={() => setDate(shiftDate(date, -1))}>
          <span aria-hidden="true">←</span><span className="sr-only">Previous day</span>
        </button>
        <label className="day-input">
          <span className="sr-only">Date</span>
          <input type="date" value={date} onChange={(e) => DATE_RE.test(e.target.value) && setDate(e.target.value)} />
        </label>
        <button type="button" className="tap-button secondary" onClick={() => setDate(shiftDate(date, 1))}>
          <span className="sr-only">Next day</span><span aria-hidden="true">→</span>
        </button>
        {!isToday ? (
          <button type="button" className="tap-button link-like" onClick={() => setDate(todayIso())}>Today</button>
        ) : null}
      </nav>

      <div role="status" aria-live="polite">
        {flash ? <p className="live-msg good">{flash}</p> : null}
      </div>

      <QueryState query={run} loadingLabel="Loading your run…">
        {(r) => !r.loads.length ? (
          <Empty>
            No loads for you on {formatDate(date)}.
            {isToday ? " Your dispatcher assigns loads when a plan is locked." : ""}
          </Empty>
        ) : (
          <>
            {r.loads.map((load) => <LoadSection key={load.load_id} load={load} date={date} />)}
          </>
        )}
      </QueryState>
    </>
  );
}

function LoadSection({ load, date }: { load: Schemas["DriverRunLoad"]; date: string }) {
  const pickups = load.orders.filter((o) => o.status === "planned");
  const deliveries = load.orders.filter((o) => o.status === "picked_up" || o.status === "in_transit");
  const done = load.orders.filter((o) => o.status === "delivered" || o.status === "exception" || o.status === "cancelled");
  const headingId = `load-${load.load_id}`;
  return (
    <section className="run-load" aria-labelledby={headingId}>
      <header className="run-load-head">
        <h2 id={headingId}>Load {load.number} <span className="zone-pill">{load.zone}</span></h2>
        <p className="muted small">
          {load.vehicle ? <>🚚 {load.vehicle.name} · <b>{load.vehicle.registration}</b></> : "No vehicle assigned yet"}
          {" · "}{plural(load.orders.length, "stop")} · {done.length} done
        </p>
      </header>

      <StopGroup title="Pickups" empty="No pickups left." orders={pickups} leg="pickup" date={date} />
      <StopGroup title="Deliveries" empty={pickups.length ? "Pick up first, then deliver." : "No deliveries left."} orders={deliveries} leg="delivery" date={date} />
      {done.length ? (
        <details className="stop-group done-group">
          <summary className="stop-group-title">Done <span className="count">({done.length})</span></summary>
          <ul className="stops">
            {done.map((o) => <Stop key={o.order_id} order={o} leg="delivery" date={date} />)}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function StopGroup({ title, empty, orders, leg, date }: {
  title: string;
  empty: string;
  orders: DriverOrder[];
  leg: "pickup" | "delivery";
  date: string;
}) {
  return (
    <div className="stop-group">
      <h3>{title} <span className="count">({orders.length})</span></h3>
      {orders.length ? (
        <ul className="stops">
          {orders.map((o) => <Stop key={o.order_id} order={o} leg={leg} date={date} />)}
        </ul>
      ) : <p className="muted small">{empty}</p>}
    </div>
  );
}

function Stop({ order, leg, date }: { order: DriverOrder; leg: "pickup" | "delivery"; date: string }) {
  const address = leg === "pickup" ? order.pickup_address : order.delivery_address;
  const n = itemCount(order);
  const dg = dgClassesText(order.lines);
  return (
    <li className={`stop stop-${order.status}`}>
      <Link className="stop-main" to={`/driver/orders/${order.order_id}`} state={{ date }}>
        <span className="stop-title">
          <b>{address.label}</b>
          <span className="small muted"> · {order.reference} · {order.company_name}</span>
        </span>
        <span className="stop-meta">
          <span>🕑 {formatWindow(order.window_start, order.window_end)}</span>
          <span>📦 {plural(n, "item")}</span>
          {dg ? (
            <span className="dg-badge driver-dg">
              <span aria-hidden="true">⚠️</span>
              <span className="dg-text">Dangerous goods: {dg}</span>
            </span>
          ) : null}
          <StatusChip status={order.status} />
        </span>
        <span className="stop-chevron" aria-hidden="true">›</span>
      </Link>
      <a className="stop-map" href={mapsUrl(address)} target="_blank" rel="noreferrer">
        <span aria-hidden="true">📍 </span>{formatAddress(address)}
        <span className="sr-only"> ({leg === "pickup" ? "pickup" : "delivery"} address, opens Google Maps)</span>
      </a>
    </li>
  );
}
