import { api, unwrap, type Schemas } from "@/shared/api";

export type PropertyRow = Schemas["PropertyRow"];
export type PropertyPage = Schemas["PropertyPage"];
export type PropertyDetail = Schemas["PropertyDetail"];
export type Pin = Schemas["PinOut"];
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
  area_min?: number;
  area_max?: number;
  floor_min?: number;
  floor_max?: number;
  not_first_floor?: boolean;
  not_top_floor?: boolean;
  building_type?: string[];
  furnished?: boolean;
  renovation?: string[];
  posted_within?: "24h" | "3d" | "7d";
  has_photos?: boolean;
  min_lat?: number;
  min_lon?: number;
  max_lat?: number;
  max_lon?: number;
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
        building_type: query.building_type?.length ? query.building_type : undefined,
        renovation: query.renovation?.length ? query.renovation : undefined,
      },
    },
  }));
}

/** Lightweight located rows for the map — same filters as the list, minus sort/paging. */
export function fetchPins(query: PropertyQuery): Promise<Pin[]> {
  return unwrap(api.GET("/api/v1/properties/pins", {
    params: {
      query: {
        district: query.district.length ? query.district : undefined,
        rooms: query.rooms.length ? query.rooms : undefined,
        status: query.status.length ? query.status : undefined,
        price_min: query.price_min, price_max: query.price_max,
        source: query.source, owner_only: query.owner_only, removed: query.removed, q: query.q,
        area_min: query.area_min, area_max: query.area_max,
        floor_min: query.floor_min, floor_max: query.floor_max,
        not_first_floor: query.not_first_floor, not_top_floor: query.not_top_floor,
        building_type: query.building_type?.length ? query.building_type : undefined,
        furnished: query.furnished, renovation: query.renovation?.length ? query.renovation : undefined,
        posted_within: query.posted_within, has_photos: query.has_photos,
        min_lat: query.min_lat, min_lon: query.min_lon, max_lat: query.max_lat, max_lon: query.max_lon,
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
