import { logCall, outcomeKey, resultingStatus } from "./api";

describe("resultingStatus", () => {
  it("is taken only for the taken outcome, vacant for everything else", () => {
    expect(resultingStatus("taken")).toBe("taken");
    for (const o of ["no_answer", "call_back", "realtor_not_owner", "do_not_contact", "wrong_number"] as const) {
      expect(resultingStatus(o)).toBe("vacant");
    }
  });
});

describe("outcomeKey", () => {
  it("namespaces under call.outcome", () => {
    expect(outcomeKey("no_answer")).toBe("call.outcome.no_answer");
  });
});

describe("logCall", () => {
  it("echoes the outcome and derives the resulting status", async () => {
    const result = await logCall({
      queueItemId: "1042",
      outcome: "taken",
      conditions: { foreigners: false, depositMonths: 2, familyOnly: false },
      note: "ok",
      nextCheck: { choice: "tomorrow" },
    });
    expect(result.queueItemId).toBe("1042");
    expect(result.outcome).toBe("taken");
    expect(result.resultingStatus).toBe("taken");
    expect(result.id).toContain("1042");
  });
});
