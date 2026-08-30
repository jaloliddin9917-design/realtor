import { api, unwrap, type Schemas } from "@/shared/api";

export type PropertyRow = Schemas["PropertyRow"];
export type PropertyPage = Schemas["PropertyPage"];
export type PropertyDetail = Schemas["PropertyDetail"];
export type StatusEvent = Schemas["StatusEventOut"];
export type PropertyStatus = PropertyRow["status"];
export type SortKey = "last_seen" | "first_seen" | "price_asc" | "price_desc";

/** The `/api/v1/properties` query params, with the multi-value ones always present as arrays. */
export interface PropertyQuery {
  district: string[];
  rooms: number[];
  price_min?: number;
  price_max?: number;
  status: PropertyStatus[];
  source?: "olx" | "telegram" | "manual";
  owner_only: boolean;
  removed: boolean;
  q?: string;
  sort: SortKey;
  page: number;
  page_size: number;
}

export function fetchProperties(query: PropertyQuery): Promise<PropertyPage> {
  return unwrap(api.GET("/api/v1/properties", {
    params: {
      // Empty arrays are dropped rather than sent as `district=`: openapi-fetch would emit
      // nothing for them anyway, and `undefined` says "no filter" to the API unambiguously.
      query: {
        ...query,
        district: query.district.length ? query.district : undefined,
        rooms: query.rooms.length ? query.rooms : undefined,
        status: query.status.length ? query.status : undefined,
      },
    },
  }));
}

export function fetchProperty(id: string): Promise<PropertyDetail> {
  return unwrap(api.GET("/api/v1/properties/{property_id}", { params: { path: { property_id: id } } }));
}

export function setPropertyStatus(id: string, status: "active" | "inactive", note?: string): Promise<StatusEvent> {
  return unwrap(api.POST("/api/v1/properties/{property_id}/status", {
    params: { path: { property_id: id } },
    body: { status, note: note ?? null },
  }));
}
