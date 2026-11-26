// Helpers shared by the driver pages.
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../api/client";
import { formatAddress } from "../shell/format";

export type DriverOrder = Schemas["DriverOrder"];
export type Address = Schemas["AddressRead"];

/** Google Maps search for an address (opens the Maps app on phones). */
export const mapsUrl = (a: Address) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(a))}`;

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

export const itemCount = (o: DriverOrder) => o.lines.reduce((s, l) => s + l.quantity, 0);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function useDriverOrder(orderId: number) {
  return useQuery({
    queryKey: ["driver", "order", orderId],
    queryFn: () => unwrap(api.GET("/api/driver/orders/{order_id}", { params: { path: { order_id: orderId } } })),
  });
}

