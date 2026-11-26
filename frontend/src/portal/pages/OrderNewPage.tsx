// /portal/orders/new: the order builder for a new order. ?from=<id> copies an
// existing order (e.g. a rejected one) as a starting point.
import { useSearchParams } from "react-router";
import { PageHeader } from "../../shell/AppShell";
import { ErrorBox, Loading } from "../../shell/QueryState";
import OrderBuilder from "../OrderBuilder";
import { useOrder } from "../queries";

export default function OrderNewPage() {
  const [params] = useSearchParams();
  const fromRaw = params.get("from");
  const fromId = fromRaw && /^\d+$/.test(fromRaw) ? Number(fromRaw) : null;
  const template = useOrder(fromId);

  return (
    <>
      <PageHeader title="New order" subtitle="Pick your items and addresses. You’ll see the price before you submit." />
      {fromId == null ? (
        <OrderBuilder />
      ) : template.isPending ? (
        <Loading label="Loading the order to copy…" />
      ) : template.error ? (
        <ErrorBox error={template.error} onRetry={() => void template.refetch()} />
      ) : (
        <OrderBuilder key={fromId} template={template.data} />
      )}
    </>
  );
}
