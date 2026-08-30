import { allSettled, fork } from "effector";
import { $detail, type PropertyDetail } from "@/entities/property";
import { statusRequested } from "./model";

const detail = { id: "p1", status: "new", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54, price_usd_min_minor: 45000, source_removed: false, needs_recheck: false, first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", listing_count: 1, source_kinds: ["olx"], probable_owner: null, photo_url: null, last_status_event: null, listings: [], status_events: [{ id: 1, from_status: null, to_status: "new", actor_type: "crawler", actor_id: null, note: null, created_at: "2026-08-12T09:00:00Z" }], duplicates: [] } as PropertyDetail;

describe("set status", () => {
  it("posts the status and updates the loaded detail", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => { bodies.push(await req.json()); return new Response(JSON.stringify({ id: 2, from_status: "new", to_status: "active", actor_type: "agent", actor_id: "u1", note: "ok", created_at: "2026-08-29T13:00:00Z" }), { status: 200, headers: { "content-type": "application/json" } }); }));
    const scope = fork({ values: [[$detail, detail]] });
    await allSettled(statusRequested, { scope, params: { id: "p1", status: "active", note: "ok" } });
    expect(bodies[0]).toEqual({ status: "active", note: "ok" });
    const d = scope.getState($detail)!;
    expect(d.status).toBe("active");
    expect(d.status_events.map((e) => e.to_status)).toEqual(["active", "new"]);
    expect(d.last_status_event?.actor_type).toBe("agent");
  });

  it("leaves a detail for another property untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 2, from_status: "new", to_status: "inactive", actor_type: "agent", actor_id: "u1", note: null, created_at: "2026-08-29T13:00:00Z" }), { status: 200, headers: { "content-type": "application/json" } })));
    const scope = fork({ values: [[$detail, detail]] });
    await allSettled(statusRequested, { scope, params: { id: "other", status: "inactive" } });
    expect(scope.getState($detail)).toEqual(detail);
  });
});
