/**
 * `active`: on a call right now, expected free by `time`. `callback`: no call in progress, a
 * callback is scheduled for `time`. `idle`: nothing queued or in progress.
 */
export type AgentActivity =
  | { kind: "active"; district: string; rooms: number; time: string }
  | { kind: "callback"; district: string; rooms: number; time: string }
  | { kind: "idle" };

export interface AgentRow {
  id: string;
  name: string;
  queued: number;
  calls: number;
  vacantFound: number;
  activity: AgentActivity;
}

export interface AgentsToday {
  rows: AgentRow[];
  callsTotal: number;
  vacantFoundTotal: number;
  duplicateCallsAvoided: number;
}

export const MOCK_AGENTS_TODAY: AgentsToday = {
  rows: [
    { id: "a1", name: "Aziz", queued: 14, calls: 22, vacantFound: 9, activity: { kind: "active", district: "chilonzor", rooms: 2, time: "16:05" } },
    { id: "a2", name: "Malika", queued: 16, calls: 25, vacantFound: 11, activity: { kind: "active", district: "yunusobod", rooms: 3, time: "15:40" } },
    { id: "a3", name: "Dilshod", queued: 11, calls: 18, vacantFound: 7, activity: { kind: "callback", district: "mirobod", rooms: 3, time: "17:00" } },
    { id: "a4", name: "Jasur", queued: 9, calls: 12, vacantFound: 4, activity: { kind: "idle" } },
  ],
  callsTotal: 77,
  vacantFoundTotal: 31,
  duplicateCallsAvoided: 2,
};

// TODO(real): GET /api/v1/agents/today
export function fetchAgentsToday(): Promise<AgentsToday> {
  return Promise.resolve(MOCK_AGENTS_TODAY);
}
