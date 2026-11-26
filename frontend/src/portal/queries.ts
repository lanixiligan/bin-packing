// TanStack Query hooks and keys for the portal API.
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../api/client";
import type { Order, OrderStatus, QuotePreviewRequest } from "./types";

export const portalKeys = {
  all: ["portal"] as const,
  items: (includeArchived: boolean) => ["portal", "items", { includeArchived }] as const,
  addresses: (includeArchived: boolean) => ["portal", "addresses", { includeArchived }] as const,
  orders: (f: OrderFilters) => ["portal", "orders", f] as const,
  order: (id: number) => ["portal", "order", id] as const,
  quote: (req: QuotePreviewRequest | null) => ["portal", "quote-preview", req] as const,
};

export interface OrderFilters {
  statuses: OrderStatus[];
  from: string;
  to: string;
}

export function useItems(includeArchived = false) {
  return useQuery({
    queryKey: portalKeys.items(includeArchived),
    queryFn: () => unwrap(api.GET("/api/portal/items", { params: { query: { include_archived: includeArchived } } })),
  });
}

export function useAddresses(includeArchived = false) {
  return useQuery({
    queryKey: portalKeys.addresses(includeArchived),
    queryFn: () => unwrap(api.GET("/api/portal/addresses", { params: { query: { include_archived: includeArchived } } })),
  });
}

export function useOrders(f: OrderFilters) {
  return useQuery({
    queryKey: portalKeys.orders(f),
    queryFn: () =>
      unwrap(api.GET("/api/portal/orders", {
        params: {
          query: {
            status: f.statuses.length ? f.statuses : undefined,
            from_date: f.from || undefined,
            to_date: f.to || undefined,
            limit: 500,
          },
        },
      })),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id: number | null) {
  return useQuery({
    queryKey: portalKeys.order(id ?? -1),
    queryFn: () => unwrap(api.GET("/api/portal/orders/{order_id}", { params: { path: { order_id: id! } } })),
    enabled: id != null && Number.isInteger(id),
  });
}

/** Prices a draft without storing it. Pass null to stay idle. */
export function useQuotePreview(req: QuotePreviewRequest | null) {
  return useQuery({
    queryKey: portalKeys.quote(req),
    queryFn: () => unwrap(api.POST("/api/portal/quote-preview", { body: req! })),
    enabled: req != null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** After an order changed: store the fresh copy and refresh the lists. */
export function useOrderSaved() {
  const qc = useQueryClient();
  return (order: Order) => {
    qc.setQueryData(portalKeys.order(order.id), order);
    void qc.invalidateQueries({ queryKey: ["portal", "orders"] });
  };
}
