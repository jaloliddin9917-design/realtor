import { allSettled, fork } from "effector";
import { toast } from "sonner";
import { i18n } from "@/shared/i18n";
import { $pins, $rows, $total, fetchPinsFx, fetchPropertiesFx, fetchPropertyFx } from "./model";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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

describe("property detail load errors", () => {
  it("stays silent on a 404 — pages/property renders property.notFound instead", async () => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ type: "about:blank", title: "x", status: 404, detail: "x", code: "not_found" }), { status: 404, headers: { "content-type": "application/problem+json" } }),
    ));
    const scope = fork();
    await allSettled(fetchPropertyFx, { scope, params: "missing" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts a translated error for anything other than a 404", async () => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ type: "about:blank", title: "x", status: 500, detail: "x", code: "internal_error" }), { status: 500, headers: { "content-type": "application/problem+json" } }),
    ));
    const scope = fork();
    await allSettled(fetchPropertyFx, { scope, params: "p1" });
    expect(toast.error).toHaveBeenCalledWith(i18n.t("errors.internal_error"));
  });
});

test("$pins holds the fetched pins", async () => {
  const pins = [{ id: "p1", latitude: 41.3, longitude: 69.2, price_usd_min_minor: 40000, rooms: 2, status: "new", source_removed: false }];
  const scope = fork({ handlers: [[fetchPinsFx, async () => pins]] });
  await allSettled(fetchPinsFx, { scope, params: { district: [], rooms: [], status: [], owner_only: false, removed: false, sort: "last_seen", page: 1, page_size: 20 } });
  expect(scope.getState($pins)).toEqual(pins);
});
