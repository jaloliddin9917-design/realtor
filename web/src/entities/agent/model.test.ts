import { allSettled, fork } from "effector";
import { agentsReceived, $agentRows, $agentsToday } from "./model";
import { mapAgentToday, type AgentRow } from "./api";

const row = (over: Partial<AgentRow>): AgentRow => ({ id: "a", name: "Aziz", inQueue: 0, calls: 0, foundVacant: 0, workingOn: null, ...over });

describe("agent model", () => {
  it("agentsReceived fills $agentRows", async () => {
    const rows = [row({ id: "a1" }), row({ id: "a2" })];
    const scope = fork();
    await allSettled(agentsReceived, { scope, params: rows });
    expect(scope.getState($agentRows).map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("$agentsToday derives calls/found-vacant totals from the rows and zeroes the untracked duplicate-avoidance stat", async () => {
    const rows = [row({ id: "a1", calls: 22, foundVacant: 9 }), row({ id: "a2", calls: 18, foundVacant: 4 })];
    const scope = fork();
    await allSettled(agentsReceived, { scope, params: rows });
    expect(scope.getState($agentsToday)).toEqual({ rows, callsTotal: 40, vacantFoundTotal: 13, duplicateCallsAvoided: 0 });
  });
});

describe("mapAgentToday", () => {
  it("maps the API's snake_case row to the view model", () => {
    expect(mapAgentToday({ id: "a1", name: "Aziz", in_queue: 14, calls: 22, found_vacant: 9, working_on: "Chilonzor · 2 xonali" }))
      .toEqual({ id: "a1", name: "Aziz", inQueue: 14, calls: 22, foundVacant: 9, workingOn: "Chilonzor · 2 xonali" });
  });

  it("passes a null working_on through as null (idle)", () => {
    expect(mapAgentToday({ id: "a4", name: "Jasur", in_queue: 9, calls: 12, found_vacant: 4, working_on: null }).workingOn).toBeNull();
  });
});
