// STUB (B-input replaces the body, keeps the props). Step 2: editable freight rows, quick-add
// presets, duplicate / delete with undo, CSV paste or import, inline validation messages.
import type { ReferenceData } from "../api/types.ts";
import type { FreightRow, RowErrors } from "../lib/freight.ts";

export interface FreightTableProps {
  reference: ReferenceData;
  rows: FreightRow[];
  onRowsChange(rows: FreightRow[]): void;
  /** From validateRows: per row id and field. */
  errors: RowErrors;
  /** From validateRows: problems with the list as a whole. */
  listErrors: string[];
}

export default function FreightTable({ rows }: FreightTableProps) {
  return <div data-testid="freight-table">{rows.length} lines</div>;
}
