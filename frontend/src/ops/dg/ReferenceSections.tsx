// Static reference parts of /ops/dg: exceptions, Table 9.2, segregation methods, sources.
import { EXCEPTIONS } from "../../dg/rules";

export function ExceptionsCard() {
  return (
    <section className="card dgc-section" aria-labelledby="dgc-ex-h">
      <h2 id="dgc-ex-h">Exceptions to Table 9.1</h2>
      <ol className="dgc-ex">
        {Object.entries(EXCEPTIONS).map(([n, text]) => (
          <li key={n}><span className="dgc-ex-n" aria-hidden="true">{n}</span><span><span className="sr-only">Exception {n}: </span>{text}</span></li>
        ))}
      </ol>
    </section>
  );
}

export function Table92Card() {
  return (
    <section className="card dgc-section" aria-labelledby="dgc-t92-h">
      <h2 id="dgc-t92-h">Table 9.2: specific incompatible goods</h2>
      <p className="muted small">These goods are incompatible, but Table 9.1 does not show this at class level.</p>
      <table className="dgc-t92">
        <thead>
          <tr><th scope="col">Dangerous goods</th><th scope="col">Incompatible with</th></tr>
        </thead>
        <tbody>
          <tr><td>Ammonium nitrate</td><td>Tetranitromethane</td></tr>
          <tr><td>Dichloroisocyanuric acid<br />Trichloroisocyanuric acid</td><td>Any bromate, chlorate, chlorite, hypochlorite, chloroisocyanurate or inorganic nitrite</td></tr>
          <tr><td>Calcium hypochlorite (dry or hydrated) and its mixtures</td><td>Ammonium nitrate, dichloroisocyanuric acid, trichloroisocyanuric acid, any chloroisocyanurate</td></tr>
          <tr><td>Class 6</td><td>Nitromethane (Class 3)</td></tr>
          <tr><td>Concentrated strong acids (Class 8)</td><td>Concentrated strong alkalis (Class 8)</td></tr>
          <tr><td>Cyanide compounds (Class 6.1)</td><td>Acids (Class 8)</td></tr>
        </tbody>
      </table>
      <p className="muted small">Acids and alkalis are both Class 8, but they can react violently. Use the SDS to find incompatibilities first.</p>
    </section>
  );
}

export function SegregationCard() {
  return (
    <section className="card dgc-section" aria-labelledby="dgc-seg-h">
      <h2 id="dgc-seg-h">When goods are incompatible</h2>
      <p>Do not load incompatible goods in the same vehicle or freight container without segregation. Use one of these methods:</p>
      <ul className="dgc-steps">
        <li>Load the incompatible goods on a different vehicle of the same combination (for example, flammable liquids on the lead trailer and oxidisers on the rear trailer).</li>
        <li>Use a segregation device that complies with ADG Code 6.11. A Type I device does not need approval. A Type II device needs a design approval.</li>
        <li>Do not put incompatible goods in the same overpack, for example a shrink-wrapped pallet.</li>
        <li>Do not stow dangerous goods and incompatible goods above each other.</li>
      </ul>
      <p><strong>Table 9.3</strong> lists goods that must never travel together on any vehicle. A segregation device does not make these loads acceptable.</p>
      <p className="muted small">The load planner keeps incompatible goods on separate vehicles: it does not plan segregation devices.</p>
    </section>
  );
}

export function SourcesNote() {
  return (
    <footer className="dgc-footer muted small">
      <p>
        Source: ADG Code Table 9.1 and Table 9.2, as published in Edition 7.8. Edition 7.9 is the current edition and is
        mandatory from 1 October 2025. The NTC is preparing a new Code. Check the matrix values against the edition that
        applies to you.
      </p>
      <p>
        This page is a reference aid. It does not replace the ADG Code, your State or Territory dangerous goods law, the SDS
        for each product, or advice from your competent authority.
      </p>
    </footer>
  );
}
