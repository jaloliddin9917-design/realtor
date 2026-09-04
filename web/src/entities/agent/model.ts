import { combine, createEvent, createStore } from "effector";
import { type AgentRow } from "./api";

/**
 * There is no standalone agents endpoint — the rows come off `GET /api/v1/dashboard`'s
 * `agents` array. `app/router.ts` is the one place allowed to know about both `entities/dashboard`
 * and `entities/agent` (entities must not import one another), so it maps that response with
 * `mapAgentToday` and forwards the rows here on this event, once per dashboard fetch.
 */
export const agentsReceived = createEvent<AgentRow[]>();

export const $agentRows = createStore<AgentRow[]>([]).on(agentsReceived, (_, rows) => rows);

/** `duplicateCallsAvoided` has no backing API field yet (nothing tracks it server-side), so it
 * stays 0 until the backend adds it — the other two totals are honestly derivable from the rows. */
export const $agentsToday = combine($agentRows, (rows) => ({
  rows,
  callsTotal: rows.reduce((sum, r) => sum + r.calls, 0),
  vacantFoundTotal: rows.reduce((sum, r) => sum + r.foundVacant, 0),
  duplicateCallsAvoided: 0,
}));
