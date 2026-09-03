export type SourceKind = "olx" | "telegram";
export type Classification = "owner" | "agent";
export type Decision = "merge" | "different";
export type PairAge = { kind: "hours"; hours: number } | { kind: "yesterday" };

export interface PhotoMatch {
  /** Which of this side's photos this is ("Rasm 1", "Rasm 2", …). */
  n: number;
  /** The matched photo on the other side, e.g. "B2". */
  match: string;
}

export interface DuplicateListingSide {
  sourceKind: SourceKind;
  /** Raw source display, e.g. "OLX.uz" or "Telegram @toshkent_ijara" — not translated, it's the source's own name. */
  sourceLabel: string;
  /** Raw posted-date label as the source shows it, e.g. "12-avg". */
  postedLabel: string;
  daysAgo: number;
  /** The ad's own heading, verbatim — source content, not app copy. */
  title: string;
  priceUsdMinor: number;
  rooms: number;
  floor: number;
  totalFloors: number;
  areaSqm: number;
  /** The ad's own description, verbatim. */
  description: string;
  phone: string;
  classification: Classification;
  /** How many distinct properties this phone number is linked to. */
  homesCount: number;
  photoMatches: PhotoMatch[];
  extraPhotos: number;
}

export interface ScoreBreakdownItem {
  id: "phone" | "photos" | "description" | "rooms_floor" | "area" | "price";
  points: number;
  params: Record<string, string | number>;
}

export interface DuplicatePair {
  id: string;
  score: number;
  district: string;
  place: string;
  rooms: number;
  age: PairAge;
  a: DuplicateListingSide;
  b: DuplicateListingSide;
  breakdown: ScoreBreakdownItem[];
}

/** The auto-merge / manual-review / auto-distinct score bands — every pair in the review queue falls between `low` and `high`. */
export const SCORE_THRESHOLDS = { auto: 0.75, low: 0.5, high: 0.75 };

export const RECENT_DECISIONS = { days: 30, count: 184, mergedPct: 93 };

function side(partial: Omit<DuplicateListingSide, "photoMatches" | "extraPhotos"> & { photoMatches: PhotoMatch[]; extraPhotos: number }): DuplicateListingSide {
  return partial;
}

/** Fixture "today" throughout this mock is Saturday, 29 Aug 2026 (matches docs/mockups). */
export const MOCK_PAIRS: DuplicatePair[] = [
  {
    id: "d1",
    score: 0.65,
    district: "chilonzor",
    place: "Qatortol",
    rooms: 2,
    age: { kind: "hours", hours: 3 },
    a: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "12-avg", daysAgo: 17,
      title: "Chilonzor, Qatortol, 2-xonali kvartira, egasidan",
      priceUsdMinor: 45000, rooms: 2, floor: 3, totalFloors: 9, areaSqm: 54,
      description: "Qatortol, 2 xonali, 3/9, 54 m², evro remont, mebel va texnika bilan. Uzoq muddatga, faqat oilaga. Egasidan, vositachilarsiz. Narx 450$.",
      phone: "+998908112437", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "B2" }, { n: 2, match: "B1" }], extraPhotos: 2,
    }),
    b: side({
      sourceKind: "telegram", sourceLabel: "Telegram @toshkent_ijara", postedLabel: "14-avg", daysAgo: 15,
      title: "Chilonzor Qatortol 2 xona 3/9 55 m² 480$",
      priceUsdMinor: 48000, rooms: 2, floor: 3, totalFloors: 9, areaSqm: 55,
      description: "Chilonzor Qatortol 2 xona 3/9 etaj 55 kv evro remont mebel texnika bor uzoq muddat oila uchun 480$ xizmat 50% #rieltor",
      phone: "+998934021855", classification: "agent", homesCount: 6,
      photoMatches: [{ n: 1, match: "A2" }, { n: 2, match: "A1" }], extraPhotos: 1,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.30, params: { pairs: 2, distance: 6 } },
      { id: "description", points: 0.15, params: { similarity: "0.71" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 2, floor: 3, total: 9 } },
      { id: "area", points: 0.05, params: { a: 54, b: 55, diffPct: 2 } },
      { id: "price", points: 0.05, params: { a: 450, b: 480, diffPct: 7 } },
    ],
  },
  {
    id: "d2",
    score: 0.71,
    district: "yunusobod",
    place: "4-kvartal",
    rooms: 3,
    age: { kind: "hours", hours: 3 },
    a: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "10-avg", daysAgo: 19,
      title: "Yunusobod, 4-kvartal, 3-xonali, uzoq muddatga",
      priceUsdMinor: 52000, rooms: 3, floor: 4, totalFloors: 9, areaSqm: 60,
      description: "4-kvartal, 3 xonali, 4/9, 60 m², yevro remont, konditsioner bor. Uzoq muddatga, oilaga.",
      phone: "+998909112203", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "B1" }, { n: 2, match: "B3" }, { n: 3, match: "B2" }], extraPhotos: 1,
    }),
    b: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "11-avg", daysAgo: 18,
      title: "3-xonali kvartira Yunusobod tumani 4-kvartal",
      priceUsdMinor: 54000, rooms: 3, floor: 4, totalFloors: 9, areaSqm: 62,
      description: "Yunusobod 4-kvartal, 3 xona, 4/9 qavat, 62 kv.m, evro remont, split bor, uzoq muddatga beriladi.",
      phone: "+998977654321", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "A2" }, { n: 2, match: "A3" }, { n: 3, match: "A1" }], extraPhotos: 0,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.35, params: { pairs: 3, distance: 5 } },
      { id: "description", points: 0.16, params: { similarity: "0.74" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 3, floor: 4, total: 9 } },
      { id: "area", points: 0.05, params: { a: 60, b: 62, diffPct: 3 } },
      { id: "price", points: 0.05, params: { a: 520, b: 540, diffPct: 4 } },
    ],
  },
  {
    id: "d3",
    score: 0.58,
    district: "sergeli",
    place: "Sputnik",
    rooms: 2,
    age: { kind: "hours", hours: 5 },
    a: side({
      sourceKind: "telegram", sourceLabel: "Telegram @arenda_uz", postedLabel: "20-avg", daysAgo: 9,
      title: "Sergeli, Sputnik massivi, 2 xona ijaraga",
      priceUsdMinor: 34000, rooms: 2, floor: 2, totalFloors: 5, areaSqm: 45,
      description: "Sputnik, 2 xona, 2/5, 45 kv, kosmetik remont, texnika bor. Oilaga uzoq muddatga.",
      phone: "+998913340021", classification: "agent", homesCount: 4,
      photoMatches: [{ n: 1, match: "B1" }, { n: 2, match: "B2" }], extraPhotos: 0,
    }),
    b: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "22-avg", daysAgo: 7,
      title: "2-xonali, Sergeli tumani, Sputnik",
      priceUsdMinor: 36000, rooms: 2, floor: 2, totalFloors: 5, areaSqm: 44,
      description: "Sergeli, Sputnik, 2/5 qavat, 44 m², kosmetik ta'mirlangan, mebel bor.",
      phone: "+998946671120", classification: "agent", homesCount: 3,
      photoMatches: [{ n: 1, match: "A2" }, { n: 2, match: "A1" }], extraPhotos: 1,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.25, params: { pairs: 2, distance: 9 } },
      { id: "description", points: 0.13, params: { similarity: "0.62" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 2, floor: 2, total: 5 } },
      { id: "area", points: 0.05, params: { a: 45, b: 44, diffPct: 2 } },
      { id: "price", points: 0.05, params: { a: 340, b: 360, diffPct: 6 } },
    ],
  },
  {
    id: "d4",
    score: 0.54,
    district: "yakkasaroy",
    place: "Bobur",
    rooms: 2,
    age: { kind: "yesterday" },
    a: side({
      sourceKind: "telegram", sourceLabel: "Telegram @toshkent_ijara", postedLabel: "24-avg", daysAgo: 5,
      title: "Yakkasaroy, Bobur ko'chasi, 2 xonali",
      priceUsdMinor: 30000, rooms: 2, floor: 5, totalFloors: 9, areaSqm: 40,
      description: "Bobur ko'chasi, 2 xona, 5/9, 40 kv, oddiy remont. Uzoq muddatga.",
      phone: "+998950012348", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "B1" }], extraPhotos: 2,
    }),
    b: side({
      sourceKind: "telegram", sourceLabel: "Telegram @arenda_uz", postedLabel: "25-avg", daysAgo: 4,
      title: "2 xona Yakkasaroy tumani, Bobur",
      priceUsdMinor: 31000, rooms: 2, floor: 5, totalFloors: 9, areaSqm: 41,
      description: "Yakkasaroy, Bobur, 5/9 qavat, 41 m², kosmetik remont bor, oilaga.",
      phone: "+998971122456", classification: "agent", homesCount: 5,
      photoMatches: [{ n: 1, match: "A1" }], extraPhotos: 3,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.20, params: { pairs: 1, distance: 7 } },
      { id: "description", points: 0.14, params: { similarity: "0.66" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 2, floor: 5, total: 9 } },
      { id: "area", points: 0.05, params: { a: 40, b: 41, diffPct: 2 } },
      { id: "price", points: 0.05, params: { a: 300, b: 310, diffPct: 3 } },
    ],
  },
  {
    id: "d5",
    score: 0.52,
    district: "mirobod",
    place: "Oybek",
    rooms: 3,
    age: { kind: "yesterday" },
    a: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "23-avg", daysAgo: 6,
      title: "Mirobod, Oybek metrosi yaqinida, 3-xonali",
      priceUsdMinor: 42000, rooms: 3, floor: 1, totalFloors: 4, areaSqm: 65,
      description: "Oybek metrosi yaqin, 3 xona, 1/4, 65 kv, sovutgich va kir yuvish mashinasi bor.",
      phone: "+998901239988", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "B2" }, { n: 2, match: "B1" }], extraPhotos: 0,
    }),
    b: side({
      sourceKind: "telegram", sourceLabel: "Telegram @mirobod_kvartira", postedLabel: "25-avg", daysAgo: 4,
      title: "3 xonali kvartira Mirobod, Oybek",
      priceUsdMinor: 45000, rooms: 3, floor: 1, totalFloors: 4, areaSqm: 63,
      description: "Mirobod, Oybek, 1/4 qavat, 63 m², texnika to'liq, uzoq muddatga beriladi.",
      phone: "+998933345567", classification: "agent", homesCount: 2,
      photoMatches: [{ n: 1, match: "A1" }, { n: 2, match: "A2" }], extraPhotos: 1,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.20, params: { pairs: 2, distance: 11 } },
      { id: "description", points: 0.12, params: { similarity: "0.58" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 3, floor: 1, total: 4 } },
      { id: "area", points: 0.05, params: { a: 65, b: 63, diffPct: 3 } },
      { id: "price", points: 0.05, params: { a: 420, b: 450, diffPct: 7 } },
    ],
  },
  {
    id: "d6",
    score: 0.51,
    district: "chilonzor",
    place: "19-kvartal",
    rooms: 3,
    age: { kind: "yesterday" },
    a: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "21-avg", daysAgo: 8,
      title: "Chilonzor 19-kvartal, 3-xonali, o'rta qavat",
      priceUsdMinor: 46000, rooms: 3, floor: 7, totalFloors: 9, areaSqm: 58,
      description: "19-kvartal, 3 xona, 7/9, 58 kv, kapital remont, mebel bor.",
      phone: "+998912209934", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "B3" }], extraPhotos: 2,
    }),
    b: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "22-avg", daysAgo: 7,
      title: "3 xonali Chilonzor 19-kv, remont qilingan",
      priceUsdMinor: 48000, rooms: 3, floor: 7, totalFloors: 9, areaSqm: 60,
      description: "Chilonzor, 19-kvartal, 7/9 qavat, 60 m², kapital ta'mir, texnika bilan.",
      phone: "+998995512067", classification: "agent", homesCount: 8,
      photoMatches: [{ n: 1, match: "A1" }], extraPhotos: 3,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.18, params: { pairs: 1, distance: 10 } },
      { id: "description", points: 0.13, params: { similarity: "0.61" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 3, floor: 7, total: 9 } },
      { id: "area", points: 0.05, params: { a: 58, b: 60, diffPct: 3 } },
      { id: "price", points: 0.05, params: { a: 480, b: 500, diffPct: 4 } },
    ],
  },
  {
    id: "d7",
    score: 0.68,
    district: "mirzo_ulugbek",
    place: "Buyuk Ipak yo'li",
    rooms: 2,
    age: { kind: "hours", hours: 6 },
    a: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "18-avg", daysAgo: 11,
      title: "Mirzo Ulug'bek, Buyuk Ipak yo'li, 2-xonali",
      priceUsdMinor: 40000, rooms: 2, floor: 6, totalFloors: 12, areaSqm: 50,
      description: "Buyuk Ipak yo'li metrosi yaqin, 2 xona, 6/12, 50 kv, yevro remont.",
      phone: "+998904456712", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "B1" }, { n: 2, match: "B2" }], extraPhotos: 1,
    }),
    b: side({
      sourceKind: "telegram", sourceLabel: "Telegram @tashkent_rent", postedLabel: "19-avg", daysAgo: 10,
      title: "2 xona, Mirzo Ulug'bek tumani",
      priceUsdMinor: 43000, rooms: 2, floor: 6, totalFloors: 12, areaSqm: 52,
      description: "Mirzo Ulug'bek, Buyuk Ipak yo'li, 6/12 qavat, 52 m², to'liq mebellangan.",
      phone: "+998918893321", classification: "agent", homesCount: 4,
      photoMatches: [{ n: 1, match: "A2" }, { n: 2, match: "A1" }], extraPhotos: 0,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.32, params: { pairs: 2, distance: 6 } },
      { id: "description", points: 0.16, params: { similarity: "0.75" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 2, floor: 6, total: 12 } },
      { id: "area", points: 0.05, params: { a: 50, b: 52, diffPct: 4 } },
      { id: "price", points: 0.05, params: { a: 400, b: 430, diffPct: 7 } },
    ],
  },
  {
    id: "d8",
    score: 0.55,
    district: "olmazor",
    place: "Bodomzor",
    rooms: 1,
    age: { kind: "hours", hours: 8 },
    a: side({
      sourceKind: "telegram", sourceLabel: "Telegram @arenda_uz", postedLabel: "26-avg", daysAgo: 3,
      title: "Olmazor, Bodomzor, 1-xonali",
      priceUsdMinor: 25000, rooms: 1, floor: 3, totalFloors: 5, areaSqm: 33,
      description: "Bodomzor, 1 xona, 3/5, 33 kv, yangi remont, yolg'iz odam yoki juftlikka.",
      phone: "+998907789012", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "B1" }], extraPhotos: 1,
    }),
    b: side({
      sourceKind: "telegram", sourceLabel: "Telegram @toshkent_ijara", postedLabel: "27-avg", daysAgo: 2,
      title: "1 xonali kvartira Olmazor, Bodomzor",
      priceUsdMinor: 26000, rooms: 1, floor: 3, totalFloors: 5, areaSqm: 34,
      description: "Olmazor tumani, Bodomzor, 3/5 qavat, 34 m², kosmetik remont.",
      phone: "+998939921456", classification: "agent", homesCount: 3,
      photoMatches: [{ n: 1, match: "A1" }], extraPhotos: 2,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.22, params: { pairs: 1, distance: 8 } },
      { id: "description", points: 0.13, params: { similarity: "0.63" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 1, floor: 3, total: 5 } },
      { id: "area", points: 0.05, params: { a: 33, b: 34, diffPct: 3 } },
      { id: "price", points: 0.05, params: { a: 260, b: 270, diffPct: 4 } },
    ],
  },
  {
    id: "d9",
    score: 0.73,
    district: "uchtepa",
    place: "Qo'yliq",
    rooms: 3,
    age: { kind: "yesterday" },
    a: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "15-avg", daysAgo: 14,
      title: "Uchtepa, Qo'yliq bozori yaqinida, 3-xonali",
      priceUsdMinor: 55000, rooms: 3, floor: 9, totalFloors: 16, areaSqm: 70,
      description: "Qo'yliq, 3 xona, 9/16, 70 kv, yevro remont, mebel va texnika to'liq.",
      phone: "+998902231144", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "B2" }, { n: 2, match: "B3" }, { n: 3, match: "B1" }], extraPhotos: 2,
    }),
    b: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "16-avg", daysAgo: 13,
      title: "3-xonali, Uchtepa tumani, Qo'yliq",
      priceUsdMinor: 58000, rooms: 3, floor: 9, totalFloors: 16, areaSqm: 72,
      description: "Uchtepa, Qo'yliq bozori yaqin, 9/16 qavat, 72 m², to'liq ta'mirlangan.",
      phone: "+998965578823", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "A1" }, { n: 2, match: "A3" }, { n: 3, match: "A2" }], extraPhotos: 1,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.38, params: { pairs: 3, distance: 4 } },
      { id: "description", points: 0.15, params: { similarity: "0.72" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 3, floor: 9, total: 16 } },
      { id: "area", points: 0.05, params: { a: 70, b: 72, diffPct: 3 } },
      { id: "price", points: 0.05, params: { a: 550, b: 580, diffPct: 5 } },
    ],
  },
  {
    id: "d10",
    score: 0.50,
    district: "shayxontohur",
    place: "Chorsu",
    rooms: 2,
    age: { kind: "yesterday" },
    a: side({
      sourceKind: "telegram", sourceLabel: "Telegram @toshkent_ijara", postedLabel: "20-avg", daysAgo: 9,
      title: "Shayxontohur, Chorsu yaqinida, 2-xonali",
      priceUsdMinor: 36000, rooms: 2, floor: 2, totalFloors: 4, areaSqm: 48,
      description: "Chorsu bozori yaqin, 2 xona, 2/4, 48 kv, kosmetik remont.",
      phone: "+998911145523", classification: "agent", homesCount: 5,
      photoMatches: [{ n: 1, match: "B1" }], extraPhotos: 1,
    }),
    b: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "22-avg", daysAgo: 7,
      title: "2 xonali kvartira Shayxontohur tumani",
      priceUsdMinor: 38000, rooms: 2, floor: 2, totalFloors: 4, areaSqm: 50,
      description: "Shayxontohur, Chorsu, 2/4 qavat, 50 m², oddiy remont, uzoq muddatga.",
      phone: "+998993367841", classification: "agent", homesCount: 2,
      photoMatches: [{ n: 1, match: "A1" }], extraPhotos: 2,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.18, params: { pairs: 1, distance: 9 } },
      { id: "description", points: 0.12, params: { similarity: "0.57" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 2, floor: 2, total: 4 } },
      { id: "area", points: 0.05, params: { a: 48, b: 50, diffPct: 4 } },
      { id: "price", points: 0.05, params: { a: 380, b: 400, diffPct: 5 } },
    ],
  },
  {
    id: "d11",
    score: 0.62,
    district: "yashnobod",
    place: "Uzex",
    rooms: 4,
    age: { kind: "yesterday" },
    a: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "17-avg", daysAgo: 12,
      title: "Yashnobod, Uzex yaqinida, 4-xonali",
      priceUsdMinor: 62000, rooms: 4, floor: 10, totalFloors: 16, areaSqm: 80,
      description: "Uzex ko'rgazma majmuasi yaqin, 4 xona, 10/16, 80 kv, yevro remont.",
      phone: "+998903312278", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "B2" }, { n: 2, match: "B1" }], extraPhotos: 2,
    }),
    b: side({
      sourceKind: "telegram", sourceLabel: "Telegram @tashkent_rent", postedLabel: "18-avg", daysAgo: 11,
      title: "4 xonali kvartira Yashnobod tumani",
      priceUsdMinor: 65000, rooms: 4, floor: 10, totalFloors: 16, areaSqm: 78,
      description: "Yashnobod, Uzex, 10/16 qavat, 78 m², to'liq mebellangan, oilaga.",
      phone: "+998971198845", classification: "agent", homesCount: 3,
      photoMatches: [{ n: 1, match: "A1" }, { n: 2, match: "A2" }], extraPhotos: 1,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.28, params: { pairs: 2, distance: 7 } },
      { id: "description", points: 0.14, params: { similarity: "0.67" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 4, floor: 10, total: 16 } },
      { id: "area", points: 0.05, params: { a: 80, b: 78, diffPct: 3 } },
      { id: "price", points: 0.05, params: { a: 600, b: 650, diffPct: 8 } },
    ],
  },
  {
    id: "d12",
    score: 0.57,
    district: "bektemir",
    place: "Zafar",
    rooms: 2,
    age: { kind: "yesterday" },
    a: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "19-avg", daysAgo: 10,
      title: "Bektemir, Zafar mahallasi, 2-xonali",
      priceUsdMinor: 35000, rooms: 2, floor: 4, totalFloors: 9, areaSqm: 47,
      description: "Zafar mahallasi, 2 xona, 4/9, 47 kv, kosmetik remont, texnika bor.",
      phone: "+998905567234", classification: "owner", homesCount: 1,
      photoMatches: [{ n: 1, match: "B1" }, { n: 2, match: "B2" }], extraPhotos: 0,
    }),
    b: side({
      sourceKind: "olx", sourceLabel: "OLX.uz", postedLabel: "20-avg", daysAgo: 9,
      title: "2 xonali, Bektemir tumani, Zafar",
      priceUsdMinor: 36000, rooms: 2, floor: 4, totalFloors: 9, areaSqm: 48,
      description: "Bektemir, Zafar, 4/9 qavat, 48 m², kosmetik ta'mirlangan.",
      phone: "+998964423190", classification: "agent", homesCount: 7,
      photoMatches: [{ n: 1, match: "A2" }, { n: 2, match: "A1" }], extraPhotos: 1,
    }),
    breakdown: [
      { id: "phone", points: 0.00, params: {} },
      { id: "photos", points: 0.24, params: { pairs: 2, distance: 8 } },
      { id: "description", points: 0.13, params: { similarity: "0.60" } },
      { id: "rooms_floor", points: 0.10, params: { rooms: 2, floor: 4, total: 9 } },
      { id: "area", points: 0.05, params: { a: 47, b: 48, diffPct: 2 } },
      { id: "price", points: 0.05, params: { a: 360, b: 375, diffPct: 4 } },
    ],
  },
];

// TODO(real): GET /api/v1/duplicates/queue
export function fetchDuplicatePairs(): Promise<DuplicatePair[]> {
  return Promise.resolve(MOCK_PAIRS);
}

// TODO(real): POST /api/v1/duplicates/{pair_id}/decision
export function decidePair(id: string, decision: Decision): Promise<{ id: string; decision: Decision }> {
  return Promise.resolve({ id, decision });
}
