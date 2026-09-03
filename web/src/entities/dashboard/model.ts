import { createEffect, createStore } from "effector";
import { fetchDashboardStats, MOCK_DASHBOARD_STATS, type DashboardStats } from "./api";

/** Seeded with the mock payload so the dashboard renders immediately; wired to a real fetch later. */
export const fetchDashboardStatsFx = createEffect(fetchDashboardStats);

export const $dashboardStats = createStore<DashboardStats>(MOCK_DASHBOARD_STATS)
  .on(fetchDashboardStatsFx.doneData, (_, stats) => stats);
