import { api, unwrap, type Schemas } from "@/shared/api";

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
  priceUsdMinor: number | null;
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

// ---- real API ----
type DashboardOut = Schemas["DashboardOut"];

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** The API carries no sub-area/micro-district field, so `place` always collapses to "" — see
 * entities/queue/api.ts's `subArea` comment for the same gap on the queue's flat fields. */
function mapRecheckItem(o: Schemas["RecheckItem"]): RecheckItem {
  return {
    id: o.id,
    district: o.district ?? "",
    place: "",
    rooms: o.rooms ?? 0,
    priceUsdMinor: o.price_usd === null ? null : o.price_usd * 100,
    confirmedDaysAgo: daysSince(o.last_checked_at),
    agent: o.agent ?? "—",
    removedFrom: o.source_removed ? "olx" : null,
  };
}

/**
 * `BotReplies` and the view model don't line up 1:1: the API's `answered` (got a classifiable
 * reply) is this screen's `sent`, and its `sent` (messages the bot sent out) is this screen's
 * `total` — mirroring the mock's own invariant that `vacant + submitted + unclear === sent`.
 * `taken` (tenant confirmed the place is gone) maps to `submitted` ("topshirilgan" in the copy
 * means the same thing). All of these read 0 today since the bot isn't built yet.
 */
function mapDashboardStats(o: DashboardOut): DashboardStats {
  return {
    vacant: { total: o.status_counts.vacant, confirmedWithin3Days: o.status_counts.vacant_confirmed_3d },
    toCheck: { count: o.status_counts.to_check_today },
    newListings: { olx: o.new_listings.olx, telegram: o.new_listings.telegram, duplicates: o.new_listings.duplicates, total: o.new_listings.total },
    botReplies: { sent: o.bot_replies.answered, total: o.bot_replies.sent, vacant: o.bot_replies.vacant, submitted: o.bot_replies.taken, unclear: o.bot_replies.unclear },
    unassignedCount: o.unassigned,
    recheckTotal: o.recheck_total,
    recheckItems: o.recheck_items.map(mapRecheckItem),
  };
}

/** The dashboard's stats and the agents-today board are one payload (`GET /api/v1/dashboard`),
 * fetched once — `agents` stays in its raw wire shape here (entities must not import one
 * another) and is mapped by `entities/agent` once `app/router.ts` forwards it there. */
export interface DashboardFetch { stats: DashboardStats; agents: Schemas["AgentToday"][] }

export function fetchDashboard(): Promise<DashboardFetch> {
  return unwrap(api.GET("/api/v1/dashboard")).then((o) => ({ stats: mapDashboardStats(o), agents: o.agents }));
}
