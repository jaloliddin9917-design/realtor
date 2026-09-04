import { logCall, outcomeKey, resultingStatus } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("resultingStatus", () => {
  it("is vacant for still_available, taken for taken, and unchanged for every other outcome", () => {
    expect(resultingStatus("still_available")).toBe("vacant");
    expect(resultingStatus("taken")).toBe("taken");
    for (const o of ["no_answer", "call_back", "realtor_not_owner", "do_not_contact", "wrong_number"] as const) {
      expect(resultingStatus(o)).toBe("unchanged");
    }
  });
});

describe("outcomeKey", () => {
  it("namespaces under call.outcome", () => {
    expect(outcomeKey("no_answer")).toBe("call.outcome.no_answer");
  });
});

describe("logCall", () => {
  it("posts the mapped log to the property's call-log endpoint and maps the receipt back", async () => {
    let url = "";
    let body: unknown = null;
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      url = req.url;
      body = JSON.parse(await req.text());
      return jsonResponse(200, {
        id: "cl-1", property_id: "pr-1042", outcome: "taken", resulting_status: "taken", logged_at: "2026-09-04T09:00:00Z",
      });
    }));

    const result = await logCall({
      queueItemId: "pr-1042",
      outcome: "taken",
      conditions: { foreigners: false, depositMonths: 2, familyOnly: false },
      note: "ok",
      nextCheck: { choice: "tomorrow" },
    });

    expect(url).toContain("/api/v1/properties/pr-1042/call-log");
    expect(body).toEqual({
      outcome: "taken",
      conditions: { foreigners: false, deposit_months: 2, family_only: false },
      note: "ok",
      next_check: { choice: "tomorrow", date: null },
    });
    expect(result).toEqual({ id: "cl-1", queueItemId: "pr-1042", outcome: "taken", resultingStatus: "taken", loggedAt: "2026-09-04T09:00:00Z" });
  });

  it("maps a still_available receipt to a vacant resulting status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, {
      id: "cl-2", property_id: "pr-1043", outcome: "still_available", resulting_status: "vacant", logged_at: "2026-09-04T09:05:00Z",
    })));

    const result = await logCall({
      queueItemId: "pr-1043",
      outcome: "still_available",
      conditions: { foreigners: false, depositMonths: null, familyOnly: false },
      note: "",
      nextCheck: { choice: "in_3_days" },
    });

    expect(result.outcome).toBe("still_available");
    expect(result.resultingStatus).toBe("vacant");
    expect(result.queueItemId).toBe("pr-1043");
  });
});
