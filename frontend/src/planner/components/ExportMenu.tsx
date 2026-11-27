// Export the load plan as CSV and as a print view (the browser's print dialog saves PDF).
// Also brings in the print styles (styles/print.css), which only apply when printing.
import type { PlanRequest, PlanResult, ReferenceData } from "../api/types.ts";
import { downloadText, planCsvFilename, planToCsv } from "../lib/export.ts";
import { DownloadIcon, PrintIcon } from "./icons.tsx";
import "../styles/print.css";
import "./ExportMenu.css";

export interface ExportMenuProps {
  result: PlanResult;
  request: PlanRequest;
  reference: ReferenceData;
}

export default function ExportMenu({ result, request, reference }: ExportMenuProps) {
  const downloadCsv = () => {
    // The BOM lets Excel read the file as UTF-8 (m³, curly quotes in labels).
    downloadText(planCsvFilename(result.vehicle_id), `\uFEFF${planToCsv(result, request, reference)}`,
                 "text/csv;charset=utf-8");
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
