// Display pieces shared by the order builder and the order detail page.
import { useEffect, useState, type ReactNode } from "react";
import { fetchBlobUrl } from "../../api/client";
import { ErrorBox } from "../../shell/QueryState";
import { STATUS_LABEL, formatAddress, formatDateTime, formatKg, formatMoney, formatPallets } from "../../shell/format";
import { formatVolume, sortEvents, type Totals } from "../logic";
import type { Address, OrderEvent, Pod, Quote } from "../types";

/** Info / warning / problem / success box. The heading carries the meaning, not only the colour. */
export function Notice({ tone, title, children, role }: {
  tone: "info" | "warn" | "bad" | "good";
  title?: ReactNode;
  children?: ReactNode;
  role?: "status" | "alert" | "note";
}) {
  return (
    <div className={`notice-box notice-${tone}`} role={role}>
      {title ? <p className="notice-title">{title}</p> : null}
      {children}
    </div>
  );
}

export interface DgNoticeEntry { key: string; content: ReactNode }

/**
 * Dangerous goods pairs on an order: incompatible ones (planned onto separate
 * vehicles) as a warning, ADG Table 9.2 checks as a softer note.
 */
export function DgNotices({ incompatible, check, checkAdvice }: {
  incompatible: DgNoticeEntry[];
  check: DgNoticeEntry[];
  checkAdvice: ReactNode;
}) {
  return (
    <>
      {incompatible.length ? (
        <Notice tone="warn" title="Some goods can’t travel together" role="note">
          <ul>{incompatible.map((x) => <li key={x.key}>{x.content}</li>)}</ul>
          <p className="small">We’ll carry them on separate vehicles, which can affect timing and price.</p>
        </Notice>
      ) : null}
      {check.length ? (
        <Notice tone="info" title="Check these goods against ADG Table 9.2" role="note">
          <ul>{check.map((x) => <li key={x.key}>{x.content}</li>)}</ul>
          <p className="small">{checkAdvice}</p>
        </Notice>
      ) : null}
    </>
  );
}

/** How the address's zone affects pricing, in words. */
export function ZoneNote({ zone }: { zone: string | null }) {
  return zone ? (
    <span className="zone-note">Zone {zone} <span className="muted">(set by dispatch)</span></span>
  ) : (
    <span className="zone-note zone-none">Not zoned yet, so prices are provisional</span>
  );
}

export function AddressBlock({ address, heading }: { address: Address; heading?: string }) {
  const labelContent = (
    <>
      {address.label}
      {address.archived ? <span className="chip chip-archived">Archived</span> : null}
    </>
  );
  return (
    <div className="address-block">
      {heading ? <h3>{heading}</h3> : null}
      {/* In the address book the label is the card's heading; under "Pickup"/"Delivery" it's plain text. */}
      {heading ? <p className="address-label">{labelContent}</p> : <h3 className="address-label">{labelContent}</h3>}
      <p>{formatAddress(address)}</p>
      {address.contact_name || address.phone ? (
        <p className="muted small">{[address.contact_name, address.phone].filter(Boolean).join(" · ")}</p>
      ) : null}
      <p className="small"><ZoneNote zone={address.zone} /></p>
      {address.notes ? <p className="muted small">{address.notes}</p> : null}
    </div>
  );
}

export function TotalsRow({ totals, label = "Totals" }: { totals: Totals; label?: string }) {
  return (
    <dl className="stats" aria-label={label}>
      <div><dt>Units</dt><dd>{totals.units.toLocaleString()}</dd></div>
      <div><dt>Weight</dt><dd>{formatKg(totals.weightKg)}</dd></div>
      <div><dt>Volume</dt><dd>{formatVolume(totals.volumeM3)}</dd></div>
      <div><dt>Pallets</dt><dd>{formatPallets(totals.pallets)}</dd></div>
    </dl>
  );
}

/** A quote, stored (final) or a preview. */
export function QuoteDetails({ quote, stored }: { quote: Quote; stored: boolean }) {
  const cubicWins = quote.cubic_weight_kg > quote.total_weight_kg + 1e-9;
  return (
    <div className="quote">
      <p className="quote-amount">
        <span className="quote-label">{stored ? "Quoted price" : "Estimated price"}</span>
        <strong>{formatMoney(quote.amount)}</strong>
        {quote.provisional ? <span className="chip chip-warn">Provisional</span> : null}
      </p>
      <dl className="quote-breakdown small">
        <div><dt>Actual weight</dt><dd>{formatKg(quote.total_weight_kg)}</dd></div>
        <div><dt>Volume</dt><dd>{formatVolume(quote.total_volume_m3)}</dd></div>
        <div>
          <dt>Chargeable (cubic) weight</dt>
          <dd>{formatKg(quote.cubic_weight_kg)}{cubicWins ? <span className="muted"> (volume × 250)</span> : null}</dd>
        </div>
        <div>
          <dt>Rate</dt>
          <dd>{formatMoney(quote.rate_per_kg)}/kg · {quote.zone_code ? `zone ${quote.zone_code}` : "default rate"}</dd>
        </div>
        {stored && quote.created_at ? <div><dt>Quoted</dt><dd>{formatDateTime(quote.created_at)}</dd></div> : null}
      </dl>
      {quote.provisional ? (
        <p className="small notice-inline">
          <strong>Provisional:</strong> the delivery address isn’t in a zone yet, so the default rate is used.
          {stored ? " Dispatch will confirm the price." : " The price may change once dispatch assigns a zone."}
        </p>
      ) : null}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { customer: "Customer", dispatcher: "Dispatch", driver: "Driver" };

function eventTitle(e: OrderEvent): string {
  if (e.from_status == null) return "Order created as a draft";
  return STATUS_LABEL[e.to_status];
}

/** The order's event log, oldest first. */
export function OrderTimeline({ events }: { events: OrderEvent[] }) {
  return (
    <ol className="timeline">
      {sortEvents(events).map((e) => (
        <li key={e.id} className={`timeline-item tl-${e.to_status}`}>
          <span className="timeline-dot" aria-hidden="true" />
          <div className="timeline-body">
            <p className="timeline-title">
              <strong>{eventTitle(e)}</strong>
              {e.from_status ? <span className="muted small"> (was {STATUS_LABEL[e.from_status].toLowerCase()})</span> : null}
            </p>
            <p className="muted small">
              {e.actor_name ?? "System"}
              {e.actor_role ? ` · ${ROLE_LABEL[e.actor_role] ?? e.actor_role}` : ""}
              {" · "}
              <time dateTime={e.created_at}>{formatDateTime(e.created_at)}</time>
            </p>
            {e.note ? <blockquote className="timeline-note">{e.note}</blockquote> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A protected POD photo: fetched with the bearer token, shown from an object URL that's revoked on unmount. */
export function PodPhoto({ url, alt }: { url: string; alt: string }) {
  const [state, setState] = useState<{ url: string; src?: string; error?: unknown }>({ url });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    fetchBlobUrl(url)
      .then((u) => {
        if (!active) return URL.revokeObjectURL(u);
        objectUrl = u;
        setState({ url, src: u });
      })
      .catch((error: unknown) => {
        if (active) setState({ url, error });
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, attempt]);

  const current = state.url === url ? state : { url };
  if (current.error) return <ErrorBox error={current.error} onRetry={() => { setState({ url }); setAttempt((n) => n + 1); }} />;
  if (!current.src) return <div className="pod-photo pod-photo-loading" role="status">Loading photo…</div>;
  return (
    <a href={current.src} target="_blank" rel="noreferrer" className="pod-photo-link">
      <img className="pod-photo" src={current.src} alt={alt} />
    </a>
  );
}

export function PodCard({ pod }: { pod: Pod }) {
  return (
    <div className="pod">
      <dl className="pod-facts">
        <div><dt>Signed by</dt><dd>{pod.signed_by}</dd></div>
        <div><dt>Delivered</dt><dd><time dateTime={pod.created_at}>{formatDateTime(pod.created_at)}</time></dd></div>
        {pod.driver_name ? <div><dt>Driver</dt><dd>{pod.driver_name}</dd></div> : null}
        {pod.note ? <div className="pod-note"><dt>Note</dt><dd>{pod.note}</dd></div> : null}
      </dl>
      <PodPhoto url={pod.photo_url} alt={`Proof of delivery photo, signed by ${pod.signed_by}`} />
    </div>
  );
}
