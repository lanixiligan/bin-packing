// An address on a stop: Maps link and the contact's phone.
import { formatAddress } from "../shell/format";
import { mapsUrl, telHref, type Address } from "./util";

/** An address with a Maps link and the contact's phone as a tel: link. */
export default function AddressBlock({ title, address }: { title: string; address: Address }) {
  return (
    <div className="addr-block">
      <h3>{title}</h3>
      <p className="addr-label"><b>{address.label}</b></p>
      <a className="addr-link" href={mapsUrl(address)} target="_blank" rel="noreferrer">
        <span aria-hidden="true">📍 </span>{formatAddress(address)}
        <span className="sr-only"> (opens Google Maps)</span>
      </a>
      {address.contact_name || address.phone ? (
        <p className="addr-contact">
          {address.contact_name ? <span>{address.contact_name}</span> : null}
          {address.phone ? (
            <a className="tap-button secondary" href={telHref(address.phone)}>
              <span aria-hidden="true">📞 </span>Call {address.phone}
              {address.contact_name ? <span className="sr-only"> ({address.contact_name})</span> : null}
            </a>
          ) : null}
        </p>
      ) : null}
      {address.notes ? <p className="small muted">Site notes: {address.notes}</p> : null}
    </div>
  );
}
