import { api, unwrap, type Schemas } from "@/shared/api";

export type SourceKind = "olx" | "telegram" | "manual";
export type Classification = "owner" | "agent" | "unknown";
/** UI-facing decision — "different" reads as "not the same home" in the buttons/toasts; the
 * wire value the API expects is "separate" (see {@link decideDuplicate}). */
export type Decision = "merge" | "different";

export interface DuplicateListingSide {
  sourceKind: SourceKind;
  /** Raw source display, e.g. "OLX.uz" or "Telegram @toshkent_ijara" — not translated, it's the source's own name. */
  sourceLabel: string;
  /** ISO timestamp or null; the UI formats it locale-aware (see shared/lib's formatDate, same as entities/listing's ListingRow). */
  postedAt: string | null;
  /** The ad's own heading, verbatim — source content, not app copy. */
  title: string;
  priceUsdMinor: number | null;
  rooms: number;
  floor: number;
  totalFloors: number;
  areaSqm: number;
  district: string;
  /** The ad's own description, verbatim. */
  description: string;
  /** "" when the property has no probable owner, or its contact isn't phone-kind. */
  phone: string;
  /** "unknown" when there is no probable owner at all. */
  classification: Classification;
  /** How many distinct properties this contact is linked to; undefined when there's no owner or the count isn't known. */
  homesCount?: number;
  /** Ready-to-use photo URLs. */
  photos: string[];
}

export interface ScoreBreakdownItem {
  id: "phone" | "photos" | "description" | "rooms_floor" | "area" | "price";
  points: number;
}

export interface DuplicatePair {
  id: string;
  score: number;
  /** When the scorer flagged this pair for review — drives the queue row's "N soat oldin" / "kecha". */
  createdAt: string;
  a: DuplicateListingSide;
  b: DuplicateListingSide;
  breakdown: ScoreBreakdownItem[];
}

export interface DuplicateThresholds { auto: number; low: number; high: number }
export interface DecidedRecent { days: number; count: number; mergedPct: number }
export interface DuplicateQueue { pairs: DuplicatePair[]; thresholds: DuplicateThresholds; decidedRecent: DecidedRecent }

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY).toISOString();
const hoursAgo = (n: number): string => new Date(Date.now() - n * HOUR).toISOString();
const photo = (pair: string, side: "a" | "b", n: number): string => `/mock/photos/${pair}-${side}-${n}.jpg`;

/**
 * Timestamps are computed relative to `Date.now()` at module load (not frozen literals) — see
 * entities/queue/api.ts's mock for the same convention. The first two pairs (score, district,
 * breakdown points) match the fixture this screen shipped with; d3–d5 are trimmed down from
 * that same original set but re-cast to exercise the real API's null-safety gaps a static mock
 * never needed: d3.b has no probable owner at all, d4.a has no photos, and d5.b is a manually
 * added listing whose contact isn't phone-kind (classification known, phone still "").
 */
export const MOCK_PAIRS: DuplicatePair[] = [
  {
    id: "d1",
    score: 0.65,
    createdAt: hoursAgo(3),
    a: {
      sourceKind: "olx", sourceLabel: "OLX.uz", postedAt: daysAgo(17),
      title: "Chilonzor, Qatortol, 2-xonali kvartira, egasidan",
      priceUsdMinor: 45000, rooms: 2, floor: 3, totalFloors: 9, areaSqm: 54, district: "chilonzor",
      description: "Qatortol, 2 xonali, 3/9, 54 m², evro remont, mebel va texnika bilan. Uzoq muddatga, faqat oilaga. Egasidan, vositachilarsiz. Narx 450$.",
      phone: "+998908112437", classification: "owner", homesCount: 1,
      photos: [photo("d1", "a", 1), photo("d1", "a", 2), photo("d1", "a", 3)],
    },
    b: {
      sourceKind: "telegram", sourceLabel: "Telegram @toshkent_ijara", postedAt: daysAgo(15),
      title: "Chilonzor Qatortol 2 xona 3/9 55 m² 480$",
      priceUsdMinor: 48000, rooms: 2, floor: 3, totalFloors: 9, areaSqm: 55, district: "chilonzor",
      description: "Chilonzor Qatortol 2 xona 3/9 etaj 55 kv evro remont mebel texnika bor uzoq muddat oila uchun 480$ xizmat 50% #rieltor",
      phone: "+998934021855", classification: "agent", homesCount: 6,
      photos: [photo("d1", "b", 1), photo("d1", "b", 2)],
    },
    breakdown: [
      { id: "phone", points: 0.00 },
      { id: "photos", points: 0.30 },
      { id: "description", points: 0.15 },
      { id: "rooms_floor", points: 0.10 },
      { id: "area", points: 0.05 },
      { id: "price", points: 0.05 },
    ],
  },
  {
    id: "d2",
    score: 0.71,
    createdAt: hoursAgo(3),
    a: {
      sourceKind: "olx", sourceLabel: "OLX.uz", postedAt: daysAgo(19),
      title: "Yunusobod, 4-kvartal, 3-xonali, uzoq muddatga",
      priceUsdMinor: 52000, rooms: 3, floor: 4, totalFloors: 9, areaSqm: 60, district: "yunusobod",
      description: "4-kvartal, 3 xonali, 4/9, 60 m², yevro remont, konditsioner bor. Uzoq muddatga, oilaga.",
      phone: "+998909112203", classification: "owner", homesCount: 1,
      photos: [photo("d2", "a", 1), photo("d2", "a", 2), photo("d2", "a", 3), photo("d2", "a", 4)],
    },
    b: {
      sourceKind: "olx", sourceLabel: "OLX.uz", postedAt: daysAgo(18),
      title: "3-xonali kvartira Yunusobod tumani 4-kvartal",
      priceUsdMinor: 54000, rooms: 3, floor: 4, totalFloors: 9, areaSqm: 62, district: "yunusobod",
      description: "Yunusobod 4-kvartal, 3 xona, 4/9 qavat, 62 kv.m, evro remont, split bor, uzoq muddatga beriladi.",
      phone: "+998977654321", classification: "owner", homesCount: 1,
      photos: [photo("d2", "b", 1), photo("d2", "b", 2), photo("d2", "b", 3)],
    },
    breakdown: [
      { id: "phone", points: 0.00 },
      { id: "photos", points: 0.35 },
      { id: "description", points: 0.16 },
      { id: "rooms_floor", points: 0.10 },
      { id: "area", points: 0.05 },
      { id: "price", points: 0.05 },
    ],
  },
  {
    id: "d3",
    score: 0.58,
    createdAt: hoursAgo(5),
    a: {
      sourceKind: "telegram", sourceLabel: "Telegram @arenda_uz", postedAt: daysAgo(9),
      title: "Sergeli, Sputnik massivi, 2 xona ijaraga",
      priceUsdMinor: 34000, rooms: 2, floor: 2, totalFloors: 5, areaSqm: 45, district: "sergeli",
      description: "Sputnik, 2 xona, 2/5, 45 kv, kosmetik remont, texnika bor. Oilaga uzoq muddatga.",
      phone: "+998913340021", classification: "agent", homesCount: 4,
      photos: [photo("d3", "a", 1), photo("d3", "a", 2)],
    },
    // No probable owner at all — tests the null-owner path (phone "", classification "unknown", no homesCount).
    b: {
      sourceKind: "olx", sourceLabel: "OLX.uz", postedAt: daysAgo(7),
      title: "2-xonali, Sergeli tumani, Sputnik",
      priceUsdMinor: 36000, rooms: 2, floor: 2, totalFloors: 5, areaSqm: 44, district: "sergeli",
      description: "Sergeli, Sputnik, 2/5 qavat, 44 m², kosmetik ta'mirlangan, mebel bor.",
      phone: "", classification: "unknown",
      photos: [photo("d3", "b", 1)],
    },
    breakdown: [
      { id: "phone", points: 0.00 },
      { id: "photos", points: 0.25 },
      { id: "description", points: 0.13 },
      { id: "rooms_floor", points: 0.10 },
      { id: "area", points: 0.05 },
      { id: "price", points: 0.05 },
    ],
  },
  {
    id: "d4",
    score: 0.54,
    createdAt: hoursAgo(30),
    // No photos at all — tests the empty-photo-grid fallback.
    a: {
      sourceKind: "telegram", sourceLabel: "Telegram @toshkent_ijara", postedAt: daysAgo(5),
      title: "Yakkasaroy, Bobur ko'chasi, 2 xonali",
      priceUsdMinor: 30000, rooms: 2, floor: 5, totalFloors: 9, areaSqm: 40, district: "yakkasaroy",
      description: "Bobur ko'chasi, 2 xona, 5/9, 40 kv, oddiy remont. Uzoq muddatga.",
      phone: "+998950012348", classification: "owner", homesCount: 1,
      photos: [],
    },
    b: {
      sourceKind: "telegram", sourceLabel: "Telegram @arenda_uz", postedAt: daysAgo(4),
      title: "2 xona Yakkasaroy tumani, Bobur",
      priceUsdMinor: 31000, rooms: 2, floor: 5, totalFloors: 9, areaSqm: 41, district: "yakkasaroy",
      description: "Yakkasaroy, Bobur, 5/9 qavat, 41 m², kosmetik remont bor, oilaga.",
      phone: "+998971122456", classification: "agent", homesCount: 5,
      photos: [photo("d4", "b", 1), photo("d4", "b", 2)],
    },
    breakdown: [
      { id: "phone", points: 0.00 },
      { id: "photos", points: 0.20 },
      { id: "description", points: 0.14 },
      { id: "rooms_floor", points: 0.10 },
      { id: "area", points: 0.05 },
      { id: "price", points: 0.05 },
    ],
  },
  {
    id: "d5",
    score: 0.52,
    createdAt: hoursAgo(26),
    a: {
      sourceKind: "olx", sourceLabel: "OLX.uz", postedAt: daysAgo(6),
      title: "Mirobod, Oybek metrosi yaqinida, 3-xonali",
      priceUsdMinor: 42000, rooms: 3, floor: 1, totalFloors: 4, areaSqm: 65, district: "mirobod",
      description: "Oybek metrosi yaqin, 3 xona, 1/4, 65 kv, sovutgich va kir yuvish mashinasi bor.",
      phone: "+998901239988", classification: "owner", homesCount: 1,
      photos: [photo("d5", "a", 1), photo("d5", "a", 2)],
    },
    // A manually added listing whose contact is known to be an agent but isn't phone-kind, and
    // whose home count isn't known — tests an owner that exists but carries partial data.
    b: {
      sourceKind: "manual", sourceLabel: "Qo'lda qo'shilgan", postedAt: daysAgo(4),
      title: "3 xonali kvartira Mirobod, Oybek",
      priceUsdMinor: 45000, rooms: 3, floor: 1, totalFloors: 4, areaSqm: 63, district: "mirobod",
      description: "Mirobod, Oybek, 1/4 qavat, 63 m², texnika to'liq, uzoq muddatga beriladi.",
      phone: "", classification: "agent",
      photos: [photo("d5", "b", 1)],
    },
    breakdown: [
      { id: "phone", points: 0.00 },
      { id: "photos", points: 0.20 },
      { id: "description", points: 0.12 },
      { id: "rooms_floor", points: 0.10 },
      { id: "area", points: 0.05 },
      { id: "price", points: 0.05 },
    ],
  },
];

export const MOCK_THRESHOLDS: DuplicateThresholds = { auto: 0.75, low: 0.5, high: 0.75 };
export const MOCK_DECIDED_RECENT: DecidedRecent = { days: 30, count: 184, mergedPct: 93 };

// ---- real API ----
type DuplicatePairOut = Schemas["DuplicatePairOut"];
type DuplicateSideOut = Schemas["DuplicateSideOut"];
type BreakdownSignal = Schemas["BreakdownItem"]["signal"];

/** The wire signal names don't all match the (older, established) i18n key names one-for-one —
 * `contact`/`photo`/`rooms_floors` on the API side became `phone`/`photos`/`rooms_floor` here. */
const SIGNAL_KEY: Record<BreakdownSignal, ScoreBreakdownItem["id"]> = {
  contact: "phone",
  photo: "photos",
  description: "description",
  rooms_floors: "rooms_floor",
  area: "area",
  price: "price",
};

/** `detail` (a free-text explanation) is always null today — nothing to render per breakdown
 * row beyond the signal's label and its points. */
function mapBreakdown(items: Schemas["BreakdownItem"][]): ScoreBreakdownItem[] {
  return items.map((b) => ({ id: SIGNAL_KEY[b.signal], points: b.points }));
}

function mapSide(s: DuplicateSideOut): DuplicateListingSide {
  return {
    sourceKind: s.source.kind,
    sourceLabel: s.source.name,
    postedAt: s.posted_at,
    title: s.title,
    priceUsdMinor: s.price.usd_minor,
    rooms: s.rooms ?? 0,
    floor: s.floor ?? 0,
    totalFloors: s.total_floors ?? 0,
    areaSqm: s.area_sqm ?? 0,
    district: s.district ?? "",
    description: s.description,
    phone: s.owner?.phone ?? "",
    classification: s.owner?.classification ?? "unknown",
    homesCount: s.owner?.home_count ?? undefined,
    photos: s.photos,
  };
}

function mapPair(o: DuplicatePairOut): DuplicatePair {
  return {
    id: o.id,
    score: o.score,
    createdAt: o.created_at,
    a: mapSide(o.a),
    b: mapSide(o.b),
    breakdown: mapBreakdown(o.breakdown),
  };
}

export function fetchDuplicates(): Promise<DuplicateQueue> {
  return unwrap(api.GET("/api/v1/duplicates")).then((o) => ({
    pairs: o.items.map(mapPair),
    // The API's two thresholds collapse onto this screen's three-value shape the same way the
    // original mock's own constants already did (its `auto` and `high` were always equal): the
    // review range runs from `review_threshold` up to `merge_threshold`, which is also the
    // auto-merge floor.
    thresholds: { auto: o.thresholds.merge_threshold, low: o.thresholds.review_threshold, high: o.thresholds.merge_threshold },
    decidedRecent: { days: o.decided_recent.days, count: o.decided_recent.count, mergedPct: o.decided_recent.merged_pct },
  }));
}

/** Records a merge/separate decision; rejects 409 `dedupe.already_decided` if someone else
 * (another agent, another tab) already decided this pair. */
export function decideDuplicate(id: string, decision: Decision): Promise<DuplicatePair> {
  return unwrap(api.POST("/api/v1/duplicates/{review_id}/decide", {
    params: { path: { review_id: id } },
    body: { decision: decision === "merge" ? "merge" : "separate" },
  })).then(mapPair);
}
