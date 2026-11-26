// Type aliases for the portal area (generated from the backend's OpenAPI schema).
import type { Schemas } from "../api/client";

export type Item = Schemas["ItemRead"];
export type ItemCreate = Schemas["ItemCreate"];
export type ItemUpdate = Schemas["ItemUpdate"];
export type Address = Schemas["AddressRead"];
export type AddressCreate = Schemas["AddressCreate"];
export type AddressUpdate = Schemas["AddressUpdate"];
export type Quote = Schemas["QuoteRead"];
export type QuotePreviewRequest = Schemas["QuotePreviewRequest"];
export type OrderSummary = Schemas["OrderSummary"];
export type Order = Schemas["OrderRead"];
export type OrderCreate = Schemas["OrderCreate"];
export type OrderUpdate = Schemas["OrderUpdate"];
export type OrderLineIn = Schemas["OrderLineIn"];
export type OrderLine = Schemas["OrderLineRead"];
export type OrderEvent = Schemas["OrderEventRead"];
export type Pod = Schemas["PodRead"];
export type OrderStatus = Schemas["OrderStatus"];
