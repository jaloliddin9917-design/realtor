import { createEffect, createStore, sample } from "effector";
import { toast } from "sonner";
import { fetchDashboard, type DashboardStats } from "./api";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

const EMPTY_DASHBOARD_STATS: DashboardStats = {
  vacant: { total: 0, confirmedWithin3Days: 0 },
  toCheck: { count: 0 },
  newListings: { olx: 0, telegram: 0, duplicates: 0, total: 0 },
  botReplies: { sent: 0, total: 0, vacant: 0, submitted: 0, unclear: 0 },
  unassignedCount: 0,
  recheckTotal: 0,
  recheckItems: [],
};

/** Load the dashboard — wired to run on `dashboard.opened` in app/router.ts, which also forwards
 * `.doneData.agents` to entities/agent so the board renders from this same single fetch. */
export const fetchDashboardFx = createEffect(fetchDashboard);

export const $dashboardStats = createStore<DashboardStats>(EMPTY_DASHBOARD_STATS)
  .on(fetchDashboardFx.doneData, (_, d) => d.stats);

export const $dashboardPending = fetchDashboardFx.pending;
/** True once the first successful load lands — lets the page show a skeleton on the initial
 * (cold-start) fetch without re-flashing it on every later refetch. */
export const $dashboardLoaded = createStore(false).on(fetchDashboardFx.doneData, () => true);

const toastErrorFx = createEffect((e: unknown) => {
  toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network"));
});
sample({ clock: fetchDashboardFx.failData, target: toastErrorFx });
