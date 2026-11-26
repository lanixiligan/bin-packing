// Order status chip. Orchestrator-owned.
import { STATUS_LABEL, type OrderStatus } from "./format";

export function StatusChip({ status }: { status: OrderStatus }) {
  return <span className={`chip status-${status}`}>{STATUS_LABEL[status]}</span>;
}
