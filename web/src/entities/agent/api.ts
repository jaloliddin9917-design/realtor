import { type Schemas } from "@/shared/api";

export interface AgentRow {
  id: string;
  name: string;
  inQueue: number;
  calls: number;
  foundVacant: number;
  /**
   * Raw free-text description of what the agent is doing right now (e.g. "Chilonzor · 2 xonali
   * · 16:05 gacha"), or `null` when idle. The API's `AgentToday.working_on` is a plain nullable
   * string — unlike the old mock, there is no `kind` telling the UI whether this is an active
   * call (locked until a time) or a scheduled callback, so the card renders it verbatim rather
   * than composing a translated sentence.
   */
  workingOn: string | null;
}

export interface AgentsToday {
  rows: AgentRow[];
  callsTotal: number;
  vacantFoundTotal: number;
  duplicateCallsAvoided: number;
}

export const MOCK_AGENTS_TODAY: AgentsToday = {
  rows: [
    { id: "a1", name: "Aziz", inQueue: 14, calls: 22, foundVacant: 9, workingOn: "Chilonzor · 2-xonali · 16:05 gacha" },
    { id: "a2", name: "Malika", inQueue: 16, calls: 25, foundVacant: 11, workingOn: "Yunusobod · 3-xonali · 15:40 gacha" },
    { id: "a3", name: "Dilshod", inQueue: 11, calls: 18, foundVacant: 7, workingOn: "Mirobod · 3-xonali · 17:00 gacha" },
    { id: "a4", name: "Jasur", inQueue: 9, calls: 12, foundVacant: 4, workingOn: null },
  ],
  callsTotal: 77,
  vacantFoundTotal: 31,
  duplicateCallsAvoided: 2,
};

type AgentToday = Schemas["AgentToday"];

/** Maps one row of `GET /api/v1/dashboard`'s `agents` array — there is no separate agents
 * endpoint, so this is called from `app/router.ts` off the dashboard fetch (see entities/dashboard). */
export function mapAgentToday(o: AgentToday): AgentRow {
  return { id: o.id, name: o.name, inQueue: o.in_queue, calls: o.calls, foundVacant: o.found_vacant, workingOn: o.working_on };
}
