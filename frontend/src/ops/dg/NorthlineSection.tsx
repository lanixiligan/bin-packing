// Northline GDE-56 acceptance rules, as a reference section of /ops/dg.
// The checks themselves live in src/dg/rules.ts (northlineIssues).
import { DgDiamond } from "../../dg/DgBadge";

type Qty = "any" | "limit" | "approval" | "prohibited";
interface AcceptRow {
  code: string;
  /** Diamond fill: a Table 9.1 column ("2.2" etc.) or "5.1" for an oxidising gas. */
  fill: string;
  category: string;
  noFood?: boolean;
  qty: { kind: Qty; text: string }[];
  req: string | string[];
  /** First row of a class group (thicker top border). */
  group?: boolean;
  info?: { summary: string; paras: string[] };
}

const ROWS: AcceptRow[] = [
  { code: "1.1", fill: "1", group: true, category: "Detonators, cartridges, bombs, urea nitrate, ammonium nitrate", qty: [{ kind: "prohibited", text: "Prohibited" }], req: "Northline does not transport Division 1.1." },
  { code: "1.2", fill: "1", category: "Incendiary devices, mines", qty: [{ kind: "prohibited", text: "Prohibited" }], req: "Northline does not transport Division 1.2." },
  { code: "1.3C", fill: "1", category: "Propellant powder", qty: [{ kind: "limit", text: "Max 50 kg" }], req: "Do not send more than 50 kg." },
  { code: "1.3F G H J K L", fill: "1", category: "Flares, fuses, powder cake, toxic", qty: [{ kind: "prohibited", text: "Prohibited" }], req: "Not accepted." },
  { code: "1.4S", fill: "1", category: "Small arms ammunition", qty: [{ kind: "any", text: "Any quantity" }], req: "For manufacturers or distributors only. Transport outside the Northline network is not permitted." },
  { code: "1.4G", fill: "1", category: "Fireworks", qty: [{ kind: "limit", text: "Max 250 kg" }], req: "Do not send more than 250 kg. Fireworks travel only within the Northern Territory." },
  { code: "1.4C", fill: "1", category: "Smokeless propellant powder", qty: [{ kind: "limit", text: "Max 250 kg" }], req: "Do not send more than 250 kg. Northline transports UN 0509 only." },
  { code: "1.4B D E F", fill: "1", category: "Detonators, secondary bursting charges", qty: [{ kind: "prohibited", text: "Prohibited" }], req: "Not accepted." },
  { code: "1.5", fill: "1", category: "Blasting explosives", qty: [{ kind: "prohibited", text: "Prohibited" }], req: "Northline does not transport Division 1.5." },
  { code: "1.6", fill: "1", category: "Substances with a minor explosion hazard", qty: [{ kind: "prohibited", text: "Prohibited" }], req: "Northline does not transport Division 1.6." },

  { code: "2.1", fill: "2.1", group: true, category: "Flammable gas", qty: [{ kind: "any", text: "Any quantity" }], req: ["Exception: no unodourised propane, butane or LPG.", "Gas cylinders: steel cage only, also when empty.", "Aerosols are approved. No steel cage is necessary."] },
  { code: "2.2", fill: "2.2", category: "Non-flammable gas", qty: [{ kind: "any", text: "Any quantity" }], req: ["Gas cylinders: steel cage only, also when empty.", "Aerosols are approved. No steel cage is necessary."] },
  { code: "2.2 (5.1)", fill: "5.1", category: "Oxidising gas", qty: [{ kind: "any", text: "Any quantity" }], req: ["Gas cylinders: steel cage only, also when empty.", "Aerosols are approved. No steel cage is necessary."] },
  {
    code: "2.3", fill: "2.3", category: "Toxic gas", noFood: true, qty: [{ kind: "approval", text: "Needs approval" }], req: ["Check with the National HSEQ Team.", "Gas cylinders: steel cage only, also when empty."],
    info: { summary: "Information needed for 2.3 approval", paras: ["Product name, SDS, UN number, quantity, consignor and location from, consignee and location to.", "Approval depends on toxicity, sensitivity to heat during transport, and potential for handling."] },
  },

  { code: "3", fill: "3", group: true, category: "Flammable liquid", qty: [{ kind: "any", text: "Any quantity" }], req: "Exception: no fuels. This includes petrol, race fuel (nitro) and aviation Avgas." },

  { code: "4.1", fill: "4.1", group: true, category: "Flammable solids", qty: [{ kind: "limit", text: "Max 50 kg" }], req: "Do not send more than 50 kg." },
  { code: "4.2", fill: "4.2", category: "Substances liable to spontaneous combustion", qty: [{ kind: "prohibited", text: "Prohibited" }], req: "Northline does not transport Division 4.2." },
  { code: "4.3", fill: "4.3", category: "Dangerous when wet", qty: [{ kind: "prohibited", text: "Prohibited" }], req: "Northline does not transport Division 4.3." },

  {
    code: "5.1", fill: "5.1", group: true, category: "Oxidising substances", qty: [{ kind: "any", text: "Any quantity" }], req: "Exception: no products with a peroxide concentration of more than 60%. Check section 3 of the SDS.",
    info: { summary: "Information needed for 5.1", paras: ["Product name, SDS, UN number, packing group, total quantity, type of packaging, quantity in each package or container, consignor and location from, consignee and location to.", "Approval depends on reactivity, % concentration, liquid or solid, sensitivity to heat, and potential for handling."] },
  },
  {
    code: "5.2", fill: "5.2", category: "Organic peroxides", qty: [{ kind: "approval", text: "Needs approval" }], req: "Check with the National HSEQ Team.",
    info: { summary: "Information needed for 5.2 approval", paras: ["Product name, SDS, UN number, quantity, type of packaging, quantity in each package or container, consignor and location from, consignee and location to.", "Approval depends on reactivity, % concentration, quantity, liquid or solid, sensitivity to heat, and potential for handling. Solids have less risk than liquids."] },
  },

  {
    code: "6.1", fill: "6", group: true, category: "Toxic substances", noFood: true, qty: [{ kind: "any", text: "Any quantity" }, { kind: "approval", text: "Needs approval" }],
    req: ["Any quantity: PG II and PG III in pails and small packages.", "Needs approval: all other types, for example large quantities in IBCs and drums. Check with the National HSEQ Team."],
    info: { summary: "Information needed for 6.1 approval", paras: ["Product name, SDS, UN number, packing group, quantity, type of packaging, quantity in each package or container, consignor and location from, consignee and location to.", "Approval depends on toxicity, quantity, liquid or solid, sensitivity to heat during transport, and potential for handling. Solids have less risk than liquids."] },
  },
  { code: "6.2", fill: "6", category: "Infectious substances", qty: [{ kind: "prohibited", text: "Prohibited" }], req: "Northline does not transport Division 6.2." },

  {
    code: "7", fill: "7", group: true, category: "Radioactive material", qty: [{ kind: "approval", text: "Needs approval" }], req: "Check with the National HSEQ Team. Northline transports UN 2910 and UN 2911 only.",
    info: { summary: "Information needed for Class 7 approval", paras: ["Product name, SDS, UN number, quantity, type of packaging, quantity in each package or container, consignor and location from, consignee and location to.", "Approval depends on type, quantity, and potential for handling."] },
  },

  { code: "8", fill: "8", group: true, category: "Corrosive (acid and alkali)", noFood: true, qty: [{ kind: "any", text: "Any quantity" }], req: "No additional Northline requirement. Table 9.1 and Table 9.2 still apply." },

  {
    code: "9", fill: "9", group: true, category: "Miscellaneous, including batteries and environmentally hazardous substances", qty: [{ kind: "any", text: "Any quantity" }, { kind: "approval", text: "Needs approval" }],
    req: ["Northline states that UN 3082 and UN 3077 are not subject to the ADG Code in a receptacle of 500 kg (L) or less, or in an IBC.", "Batteries must meet Northline GDE-55 Transport of Lithium Batteries.", "Needs approval: environmentally hazardous substances."],
    info: { summary: "Information needed for Class 9 approval", paras: ["Product name, SDS, UN number, quantity, consignor and location from, consignee and location to, type of packaging (for example IBC or wooden crate)."] },
  },
];

const QTY_CLASS: Record<Qty, string> = { any: "k-ok", limit: "k-lim", approval: "k-cond", prohibited: "k-bad" };

const RULES: [string, string][] = [
  ["No Packing Group I", "Northline does not transport Packing Group I goods. Classes 1, 2, 5.2 and 7 do not have packing groups."],
  ["Steel cage for gas cylinders", "A steel cage is the only accepted method for gas cylinders, also when the cylinders are empty. Aerosols do not need a cage."],
  ["Not with food", "Classes 2.3, 6.1 and 8 cannot travel with food."],
  ["Approval from the National HSEQ Team", "For “Needs approval” goods, send the data listed for the class. FCL has a much lower risk than LCL handling in Northline depots."],
];

export function QtyLegend() {
  return (
    <ul className="dgc-legend" aria-label="Quantity legend">
      <li><span className="dgc-code k-ok">Any quantity</span> Accepted, exceptions apply</li>
      <li><span className="dgc-code k-lim">Max 50 kg</span> Accepted up to the limit</li>
      <li><span className="dgc-code k-cond">Needs approval</span> Ask the National HSEQ Team</li>
      <li><span className="dgc-code k-bad">Prohibited</span> Not accepted</li>
    </ul>
  );
}

export default function NorthlineSection() {
  return (
    <section className="card dgc-section" aria-labelledby="dgc-nl-h">
      <h2 id="dgc-nl-h">Northline requirements</h2>
      <p>Northline adds its own acceptance rules to the ADG Code. A load can be compatible under Table 9.1 and still not be accepted by Northline. Check both before you book.</p>
      <p className="muted small">
        Source: Northline GDE-56 Dangerous Goods – types we carry, Rev 5.0, issue date 26/09/25. The document is uncontrolled in printed form. Confirm the current revision with Northline.
      </p>

      <ul className="dgc-nl-rules">
        {RULES.map(([title, text]) => (
          <li key={title}><strong>{title}</strong><span>{text}</span></li>
        ))}
      </ul>

      <QtyLegend />

      <div className="dgc-scroll" role="region" aria-labelledby="dgc-nlt-cap" tabIndex={0}>
        <table className="dgc-nlt">
          <caption id="dgc-nlt-cap" className="sr-only">Northline dangerous goods acceptance by class</caption>
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col">Category</th>
              <th scope="col">Quantity</th>
              <th scope="col">Requirements</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.flatMap((r) => {
              const rows = [
                <tr key={r.code} className={r.group ? "grp" : undefined}>
                  <th scope="row" className="dgc-cl">
                    <span className="dgc-rh"><DgDiamond code={r.fill} size="sm" /><b>{r.code}</b></span>
                  </th>
                  <td>
                    {r.category}
                    {r.noFood ? <><br /><span className="dgc-nofood">Cannot travel with food</span></> : null}
                  </td>
                  <td className="dgc-qty">
                    {r.qty.map((q) => <span key={q.text} className={`dgc-code ${QTY_CLASS[q.kind]}`}>{q.text}</span>)}
                  </td>
                  <td>
                    {Array.isArray(r.req) ? <ul>{r.req.map((t) => <li key={t}>{t}</li>)}</ul> : r.req}
                  </td>
                </tr>,
              ];
              if (r.info) {
                rows.push(
                  <tr key={`${r.code}-info`} className="info">
                    <td />
                    <td colSpan={3}>
                      <details>
                        <summary>{r.info.summary}</summary>
                        {r.info.paras.map((p) => <p key={p}>{p}</p>)}
                      </details>
                    </td>
                  </tr>,
                );
              }
              return rows;
            })}
          </tbody>
        </table>
      </div>

      <ul className="dgc-contacts" aria-label="Northline contacts">
        <li className="dgc-contact"><h3>DG approvals</h3><a href="mailto:Safety@northline.com.au">Safety@northline.com.au</a></li>
        <li className="dgc-contact"><h3>Tristan Wait</h3><a href="tel:+61461489116">0461 489 116</a></li>
        <li className="dgc-contact"><h3>Brett Williams</h3><a href="tel:+61421586217">0421 586 217</a></li>
      </ul>
    </section>
  );
}
