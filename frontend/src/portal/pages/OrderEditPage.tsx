// /portal/orders/:orderId/edit: the order builder for a draft.
import { Link, useLocation, useParams } from "react-router";
import { PageHeader } from "../../shell/AppShell";
import { StatusChip } from "../../shell/StatusChip";
import { QueryState } from "../../shell/QueryState";
import { Notice } from "../components/OrderParts";
import OrderBuilder from "../OrderBuilder";
import { useOrder } from "../queries";

export default function OrderEditPage() {
  const { orderId } = useParams();
  const id = orderId && /^\d+$/.test(orderId) ? Number(orderId) : null;
  const location = useLocation();
  const flash = (location.state as { flash?: string } | null)?.flash ?? null;
  const query = useOrder(id);

  if (id == null) return <Notice tone="bad" title="Order not found." role="alert"><Link to="/portal/orders">Back to orders</Link></Notice>;
  return (
    <QueryState query={query} loadingLabel="Loading the draft…">
      {(order) => (
        <>
          <PageHeader
            title={<>Edit {order.reference} <StatusChip status={order.status} /></>}
            subtitle={<Link to={`/portal/orders/${order.id}`}>Back to the order</Link>}
          />
          {order.status === "draft" ? (
            <OrderBuilder key={order.id} order={order} flash={flash} />
          ) : (
            <Notice tone="info" title="Only drafts can be edited." role="note">
              This order is already {order.status.replace("_", " ")}. <Link to={`/portal/orders/${order.id}`}>View the order</Link>.
            </Notice>
          )}
        </>
      )}
    </QueryState>
  );
}
