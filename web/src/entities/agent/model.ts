import { createEffect, createStore } from "effector";
import { fetchAgentsToday, MOCK_AGENTS_TODAY, type AgentsToday } from "./api";

/** Seeded with the mock payload so the board renders immediately; wired to a real fetch later. */
export const fetchAgentsTodayFx = createEffect(fetchAgentsToday);

export const $agentsToday = createStore<AgentsToday>(MOCK_AGENTS_TODAY)
  .on(fetchAgentsTodayFx.doneData, (_, data) => data);

export const $agentRows = $agentsToday.map((d) => d.rows);
