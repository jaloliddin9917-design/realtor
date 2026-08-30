import { allSettled, fork } from "effector";
import { $rows, $total, fetchPropertiesFx } from "./model";

describe("property list", () => {
  it("loads a page and exposes rows/total", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      calls.push(req.url);
      return new Response(JSON.stringify({ items: [{ id: "p1", status: "new", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54, price_usd_min_minor: 45000, source_removed: false, needs_recheck: false, first_seen_at: "2026-08-29T12:00:00Z", last_seen_at: "2026-08-29T12:00:00Z", listing_count: 1, source_kinds: ["olx"], probable_owner: null, photo_url: null, last_status_event: null }], total: 1, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const scope = fork();
    await allSettled(fetchPropertiesFx, { scope, params: { district: ["chilonzor"], rooms: [2], status: [], owner_only: false, removed: false, sort: "last_seen", page: 1, page_size: 20 } });
    expect(scope.getState($total)).toBe(1);
    expect(scope.getState($rows)[0]?.id).toBe("p1");
    expect(calls[0]).toContain("/api/v1/properties?");
    expect(calls[0]).toContain("district=chilonzor");
    expect(calls[0]).toContain("rooms=2");
  });
});
