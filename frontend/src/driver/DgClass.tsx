// The dangerous goods class of a driver's line: placard diamond + "Class 3 · UN 1263".
import { DgDiamond } from "../dg/DgBadge";
import type { Schemas } from "../api/client";

type DriverLine = Schemas["DriverLine"];

export default function DgClass({ line }: { line: Pick<DriverLine, "dg_class" | "un_number"> }) {
  if (!line.dg_class) return null;
  return (
    <span className="dg-badge driver-dg">
      <DgDiamond code={line.dg_class} />
      <span className="dg-text">
        Dangerous goods: Class {line.dg_class}
        {line.un_number ? <span className="dg-sub"> · UN {line.un_number}</span> : null}
      </span>
    </span>
  );
}
