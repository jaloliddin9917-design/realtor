import { api, unwrap, type Schemas } from "@/shared/api";

export type QueueStateKind = "mine" | "new" | "locked" | "retry";
export type OwnerClassification = "owner" | "agent" | "unknown";
export type AvailabilityStatus = "vacant" | "taken" | "unknown";
export type QueueSource = "olx" | "telegram" | "manual";

export interface QueueOwner {
  phone: string;
  classification: OwnerClassification;
  homeCount?: number;
}

export interface QueueActivity {
  text: string;
  at: string;
}

export interface QueueAvailability {
  status: AvailabilityStatus;
  at: string;
}

export interface QueueState {
  kind: QueueStateKind;
  until?: string;
  agentName?: string;
}

export interface QueueItem {
  id: string;
  propertyId: string;
  district: string;
  /** Micro-district / street — not in the eventual API's flat fields, but every real Tashkent
   * address carries one (see the mockup's "Chilonzor, Qatortol"), so it stays for demo fidelity. */
  subArea: string;
  rooms: number;
  floor: number;
  totalFloors: number;
  areaSqm: number;
  priceUsd: number;
  availability: QueueAvailability;
  owner: QueueOwner;
  lastActivity: QueueActivity;
  state: QueueState;
  source: QueueSource;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const minutesAgo = (n: number): string => new Date(Date.now() - n * MINUTE).toISOString();
const hoursAgo = (n: number): string => new Date(Date.now() - n * HOUR).toISOString();
const hoursFromNow = (n: number): string => new Date(Date.now() + n * HOUR).toISOString();

/**
 * Timestamps are computed relative to `Date.now()` at build time (not frozen literals), so
 * "35 daqiqa oldin" / "kecha 18:20" stay plausible whenever the app is actually opened rather
 * than drifting stale the day after this file was written.
 */
function buildMockQueue(): QueueItem[] {
  return [
    {
      id: "1042", propertyId: "pr-1042", district: "chilonzor", subArea: "Qatortol", rooms: 2, floor: 3, totalFloors: 9, areaSqm: 54, priceUsd: 450,
      availability: { status: "vacant", at: hoursAgo(2) },
      owner: { phone: "+998908112437", classification: "owner" },
      lastActivity: { text: "Malika bugun 09:12 da qo'ng'iroq qildi — javob yo'q.", at: hoursAgo(2) },
      state: { kind: "mine", until: hoursFromNow(2) },
      source: "olx",
    },
    {
      id: "1043", propertyId: "pr-1043", district: "sergeli", subArea: "7-mavze", rooms: 2, floor: 1, totalFloors: 5, areaSqm: 48, priceUsd: 350,
      availability: { status: "unknown", at: minutesAgo(35) },
      owner: { phone: "", classification: "unknown" },
      lastActivity: { text: "Hech kim hali aloqa qilmagan", at: minutesAgo(35) },
      state: { kind: "new" },
      source: "olx",
    },
    {
      id: "1044", propertyId: "pr-1044", district: "yunusobod", subArea: "4-kvartal", rooms: 3, floor: 5, totalFloors: 9, areaSqm: 78, priceUsd: 650,
      availability: { status: "unknown", at: hoursAgo(3) },
      owner: { phone: "", classification: "unknown" },
      lastActivity: { text: "Malika qo'ng'iroq qilmoqda", at: hoursAgo(3) },
      state: { kind: "locked", until: hoursFromNow(1.5), agentName: "Malika" },
      source: "telegram",
    },
    {
      id: "1045", propertyId: "pr-1045", district: "mirzo_ulugbek", subArea: "TTZ", rooms: 1, floor: 2, totalFloors: 4, areaSqm: 32, priceUsd: 300,
      availability: { status: "unknown", at: hoursAgo(28) },
      owner: { phone: "", classification: "agent", homeCount: 6 },
      lastActivity: { text: "Javob yo'q", at: hoursAgo(28) },
      state: { kind: "retry" },
      source: "olx",
    },
    {
      id: "1046", propertyId: "pr-1046", district: "mirobod", subArea: "Buyuk Ipak Yo'li", rooms: 3, floor: 4, totalFloors: 12, areaSqm: 65, priceUsd: 500,
      availability: { status: "vacant", at: hoursAgo(5) },
      owner: { phone: "+998934451209", classification: "owner" },
      lastActivity: { text: "Aziz kecha 18:40 da suhbatlashdi — ijara shartlari kelishilmoqda.", at: hoursAgo(5) },
      state: { kind: "mine", until: hoursFromNow(3) },
      source: "manual",
    },
    {
      id: "1047", propertyId: "pr-1047", district: "yakkasaroy", subArea: "Oybek", rooms: 2, floor: 6, totalFloors: 9, areaSqm: 58, priceUsd: 700,
      availability: { status: "vacant", at: hoursAgo(1) },
      owner: { phone: "+998972235618", classification: "owner" },
      lastActivity: { text: "Dilshod bugun 11:30 da qo'ng'iroq qildi — o'ylab ko'radi.", at: hoursAgo(1) },
      state: { kind: "mine", until: hoursFromNow(1) },
      source: "olx",
    },
    {
      id: "1048", propertyId: "pr-1048", district: "olmazor", subArea: "Bo'zsu", rooms: 1, floor: 2, totalFloors: 5, areaSqm: 36, priceUsd: 280,
      availability: { status: "unknown", at: minutesAgo(12) },
      owner: { phone: "", classification: "unknown" },
      lastActivity: { text: "Hech kim hali aloqa qilmagan", at: minutesAgo(12) },
      state: { kind: "new" },
      source: "telegram",
    },
    {
      id: "1049", propertyId: "pr-1049", district: "bektemir", subArea: "Qorasuv", rooms: 3, floor: 1, totalFloors: 4, areaSqm: 70, priceUsd: 380,
      availability: { status: "unknown", at: minutesAgo(50) },
      owner: { phone: "", classification: "unknown" },
      lastActivity: { text: "Hech kim hali aloqa qilmagan", at: minutesAgo(50) },
      state: { kind: "new" },
      source: "manual",
    },
    {
      id: "1050", propertyId: "pr-1050", district: "shayxontohur", subArea: "Chorsu", rooms: 2, floor: 3, totalFloors: 5, areaSqm: 50, priceUsd: 420,
      availability: { status: "unknown", at: minutesAgo(4) },
      owner: { phone: "", classification: "unknown" },
      lastActivity: { text: "Hech kim hali aloqa qilmagan", at: minutesAgo(4) },
      state: { kind: "new" },
      source: "olx",
    },
    {
      id: "1051", propertyId: "pr-1051", district: "uchtepa", subArea: "Qo'yliq", rooms: 2, floor: 7, totalFloors: 9, areaSqm: 55, priceUsd: 400,
      availability: { status: "unknown", at: hoursAgo(1) },
      owner: { phone: "", classification: "unknown" },
      lastActivity: { text: "Dilshod qo'ng'iroq qilmoqda", at: hoursAgo(1) },
      state: { kind: "locked", until: hoursFromNow(2.5), agentName: "Dilshod" },
      source: "olx",
    },
    {
      id: "1052", propertyId: "pr-1052", district: "yangihayot", subArea: "Bog'ishamol", rooms: 4, floor: 2, totalFloors: 9, areaSqm: 90, priceUsd: 600,
      availability: { status: "unknown", at: hoursAgo(30) },
      owner: { phone: "", classification: "unknown" },
      lastActivity: { text: "Javob yo'q", at: hoursAgo(30) },
      state: { kind: "retry" },
      source: "telegram",
    },
    {
      id: "1053", propertyId: "pr-1053", district: "yashnobod", subArea: "Choshtepa", rooms: 1, floor: 3, totalFloors: 5, areaSqm: 33, priceUsd: 260,
      availability: { status: "unknown", at: hoursAgo(26) },
      owner: { phone: "", classification: "unknown" },
      lastActivity: { text: "Javob yo'q", at: hoursAgo(26) },
      state: { kind: "retry" },
      source: "olx",
    },
  ];
}

// ---- real API ----
type QueueItemOut = Schemas["QueueItemOut"];

/** Map the API's snake_case queue row to the view model the UI renders. A property with no
 * parsed rooms/floor/area/district yet collapses to 0 / "" for display. */
function mapItem(o: QueueItemOut): QueueItem {
  return {
    id: o.id,
    propertyId: o.property_id,
    district: o.district ?? "",
    subArea: o.sub_area,
    rooms: o.rooms ?? 0,
    floor: o.floor ?? 0,
    totalFloors: o.total_floors ?? 0,
    areaSqm: o.area_sqm ?? 0,
    priceUsd: o.price_usd,
    availability: { status: o.availability.status, at: o.availability.at },
    owner: { phone: o.owner.phone, classification: o.owner.classification, homeCount: o.owner.home_count ?? undefined },
    lastActivity: { text: o.last_activity.text, at: o.last_activity.at },
    state: { kind: o.state.kind, until: o.state.until ?? undefined, agentName: o.state.agent_name ?? undefined },
    source: o.source,
  };
}

export type QueueScope = "all" | "today" | "retry";

export function fetchQueue(scope: QueueScope = "all"): Promise<QueueItem[]> {
  return unwrap(api.GET("/api/v1/queue", { params: { query: { scope } } })).then((rows) => rows.map(mapItem));
}

/** Claim the item as mine for the next four hours; rejects 409 `queue.locked` if another agent holds it. */
export function takeItem(id: string): Promise<QueueItem> {
  return unwrap(api.POST("/api/v1/queue/{property_id}/take", { params: { path: { property_id: id } } })).then(mapItem);
}

/** Release my claim back to the open pool (also happens server-side when a call is logged). */
export function releaseItem(id: string): Promise<void> {
  return unwrap(api.POST("/api/v1/queue/{property_id}/release", { params: { path: { property_id: id } } })).then(() => undefined);
}

/** Test fixture only — production reads {@link fetchQueue}. Kept so the Queue tests can seed
 * `$items` with a full, state-varied board without standing up the API. */
export const MOCK_QUEUE: QueueItem[] = buildMockQueue();
