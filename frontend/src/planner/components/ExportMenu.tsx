// Export the load plan as CSV and as a print view (the browser's print dialog saves PDF). In split
// mode (`fleet`) the CSV covers every truck, with a Truck column, and the print view prints them all.
// Also brings in the print styles (styles/print.css), which only apply when printing.
import type { FleetResult, PlanRequest, PlanResult, ReferenceData } from "../api/types.ts";
import { downloadText, fleetToCsv, planCsvFilename, planToCsv } from "../lib/export.ts";
import { DownloadIcon, PrintIcon } from "./icons.tsx";
import "../styles/print.css";
import "./ExportMenu.css";

interface ExportBase {
  /** The request the plan (or the split) answers. */
  request: PlanRequest;
  reference: ReferenceData;
}
/** One truck (`result`) or a split across trucks (`fleet`). */
export type ExportMenuProps = ExportBase & (
  | { result: PlanResult; fleet?: undefined }
  | { fleet: FleetResult; result?: undefined }
);

export default function ExportMenu({ result, fleet, request, reference }: ExportMenuProps) {
  const downloadCsv = () => {
    const [name, csv] = fleet
      ? [planCsvFilename(fleet.vehicle_id, new Date(), fleet.num_trucks), fleetToCsv(fleet, request, reference)]
      : [planCsvFilename(result.vehicle_id), planToCsv(result, request, reference)];
    // The BOM lets Excel read the file as UTF-8 (m³, curly quotes in labels).
    downloadText(name, `\uFEFF${csv}`, "text/csv;charset=utf-8");
  };
  return (
    <div className="export-menu no-print" role="group" aria-label="Export the load plan" data-testid="export-menu">
      <button type="button" className="btn btn-sm" onClick={downloadCsv}>
        <DownloadIcon size={14} />
        Download CSV
      </button>
      <button type="button" className="btn btn-sm" onClick={() => window.print()}>
        <PrintIcon size={14} />
        Print / PDF
      </button>
    </div>
  );
}
