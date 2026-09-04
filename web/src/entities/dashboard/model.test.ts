import { allSettled, fork } from "effector";
import { toast } from "sonner";
import { i18n } from "@/shared/i18n";
import { $dashboardStats, fetchDashboardFx } from "./model";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
/** An ISO timestamp `n` days before "now", computed at call time so the expectation doesn't drift. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000 - 3_600_000).toISOString();

const raw = {
  status_counts: { new: 5, taken: 12, to_check_today: 27, vacant: 148, vacant_confirmed_3d: 121 },
  new_listings: { olx: 38, telegram: 25, manual: 1, duplicates: 9, total: 63 },
  bot_replies: { answered: 41, sent: 96, taken: 9, unclear: 3, vacant: 29 },
  unassigned: 38,
  auto_distribute: true,
  recheck_total: 27,
  recheck_items: [
    { id: "r1", district: "sergeli", rooms: 2, price_usd: 380, last_checked_at: daysAgo(4), agent: "Malika", source_removed: false },
    // nulls the API allows: no district/rooms/price/agent yet, and removed from source
    { id: "r2", district: null, rooms: null, price_usd: null, last_checked_at: daysAgo(3), agent: null, source_removed: true },
  ],
  agents: [
    { id: "a1", name: "Aziz", in_queue: 14, calls: 22, found_vacant: 9, working_on: "Chilonzor · 2 xonali" },
    { id: "a4", name: "Jasur", in_queue: 9, calls: 12, found_vacant: 4, working_on: null },
  ],
};

describe("fetchDashboardFx", () => {
  it("maps status_counts/new_listings/bot_replies/recheck_items and passes the raw agents through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(raw)));
    const scope = fork();
    const result = await allSettled(fetchDashboardFx, { scope });
    expect(result.status).toBe("done");

    const stats = scope.getState($dashboardStats);
    expect(stats.vacant).toEqual({ total: 148, confirmedWithin3Days: 121 });
    expect(stats.toCheck).toEqual({ count: 27 });
    expect(stats.newListings).toEqual({ olx: 38, telegram: 25, duplicates: 9, total: 63 });
    // answered -> sent, sent -> total, taken -> submitted (see the mapping comment in api.ts)
    expect(stats.botReplies).toEqual({ sent: 41, total: 96, vacant: 29, submitted: 9, unclear: 3 });
    expect(stats.unassignedCount).toBe(38);
    expect(stats.recheckTotal).toBe(27);

    expect(stats.recheckItems[0]).toEqual({ id: "r1", district: "sergeli", place: "", rooms: 2, priceUsdMinor: 38000, confirmedDaysAgo: 4, agent: "Malika", removedFrom: null });
    // r2 exercises every nullable field: district/rooms fall back to ""/0, price_usd stays null
    // (not coerced to 0, which would render as a fake "$0" instead of a dash), agent falls back
    // to the app's usual null placeholder, and source_removed=true maps to "olx" (the only kind today).
    expect(stats.recheckItems[1]).toEqual({ id: "r2", district: "", place: "", rooms: 0, priceUsdMinor: null, confirmedDaysAgo: 3, agent: "—", removedFrom: "olx" });
  });

  it("resolves the agents array untouched (raw wire shape) for app/router.ts to map and forward", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(raw)));
    const scope = fork();
    const result = await allSettled(fetchDashboardFx, { scope });
    expect(result).toEqual({ status: "done", value: { stats: expect.any(Object), agents: raw.agents } });
  });
});

describe("dashboard fetch errors", () => {
  it("toasts a translated error when the dashboard request fails", async () => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ type: "about:blank", title: "x", status: 500, detail: "x", code: "internal_error" }), { status: 500, headers: { "content-type": "application/problem+json" } }),
    ));
    const scope = fork();
    await allSettled(fetchDashboardFx, { scope });
    expect(toast.error).toHaveBeenCalledWith(i18n.t("errors.internal_error"));
  });
});
