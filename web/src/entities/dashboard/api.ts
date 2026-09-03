export interface VacantStat { total: number; confirmedWithin3Days: number }
export interface ToCheckStat { count: number }
export interface NewListingsStat { olx: number; telegram: number; duplicates: number; total: number }
export interface BotRepliesStat { sent: number; total: number; vacant: number; submitted: number; unclear: number }

export type RemovedFrom = "olx" | "telegram" | null;

export interface RecheckItem {
  id: string;
  district: string;
  place: string;
  rooms: number;
  priceUsdMinor: number;
  confirmedDaysAgo: number;
  agent: string;
  removedFrom: RemovedFrom;
}

export interface DashboardStats {
  vacant: VacantStat;
  toCheck: ToCheckStat;
  newListings: NewListingsStat;
  botReplies: BotRepliesStat;
  unassignedCount: number;
  /** Oldest-confirmed-first; `recheckTotal` can exceed `recheckItems.length` — the page shows the top few. */
  recheckTotal: number;
  recheckItems: RecheckItem[];
}

/** Fixture "today" throughout this mock is Saturday, 29 Aug 2026 (matches docs/mockups). */
export const MOCK_DASHBOARD_STATS: DashboardStats = {
  vacant: { total: 148, confirmedWithin3Days: 121 },
  toCheck: { count: 27 },
  newListings: { olx: 38, telegram: 25, duplicates: 9, total: 63 },
  botReplies: { sent: 41, total: 96, vacant: 29, submitted: 9, unclear: 3 },
  unassignedCount: 38,
  recheckTotal: 27,
  recheckItems: [
    { id: "r1", district: "sergeli", place: "Sputnik", rooms: 2, priceUsdMinor: 38000, confirmedDaysAgo: 4, agent: "Malika", removedFrom: null },
    { id: "r2", district: "yakkasaroy", place: "Shota Rustaveli", rooms: 1, priceUsdMinor: 32000, confirmedDaysAgo: 3, agent: "Malika", removedFrom: null },
    { id: "r3", district: "chilonzor", place: "19-kvartal", rooms: 3, priceUsdMinor: 55000, confirmedDaysAgo: 3, agent: "Aziz", removedFrom: "olx" },
    { id: "r4", district: "yunusobod", place: "11-kvartal", rooms: 2, priceUsdMinor: 48000, confirmedDaysAgo: 3, agent: "Dilshod", removedFrom: null },
  ],
};

// TODO(real): GET /api/v1/dashboard
export function fetchDashboardStats(): Promise<DashboardStats> {
  return Promise.resolve(MOCK_DASHBOARD_STATS);
}
