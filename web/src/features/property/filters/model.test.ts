import { allSettled, fork, scopeBind } from "effector";
import { createMemoryHistory } from "history";
import { toast } from "sonner";
import { $tokens, sessionRestored } from "@/entities/session";
import { fetchPropertiesFx } from "@/entities/property";
import { i18n, i18nReady } from "@/shared/i18n";
import { controls, router, routes } from "@/shared/router";
import { $advancedCount, $district, $pageCount, $q, $query, $rooms, advancedReset, areaChanged, buildingTypeToggled, districtToggled, filtersCleared, floorChanged, furnishedChanged, hasPhotosToggled, notFirstFloorToggled, notTopFloorToggled, pageChanged, postedWithinChanged, renovationToggled, roomsToggled, searchChanged } from "./model";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

async function openList(scope: ReturnType<typeof fork>, url = "/properties") {
  const history = createMemoryHistory({ initialEntries: [url] });
  await allSettled(router.setHistory, { scope, params: history });
  await allSettled(sessionRestored, { scope, params: { id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" } });
  return history;
}

describe("filters ↔ URL", () => {
  beforeAll(() => i18nReady);

  it("requests the list exactly once for a URL that already carries filters", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.url.includes("/api/v1/properties")) calls.push(req.url);
      return new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    await openList(scope, "/properties?district=chilonzor&status=active");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("district=chilonzor");
    expect(calls[0]).toContain("status=active");
  });

  it("reads filters from the query string", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } })));
    await openList(scope, "/properties?district=chilonzor,yunusobod&rooms=2&price_min=300&status=active&sort=price_asc&page=2");
    expect(scope.getState($query)).toEqual({ district: ["chilonzor", "yunusobod"], rooms: [2], price_min: 300, price_max: undefined, status: ["active"], source: undefined, owner_only: false, removed: false, q: undefined, sort: "price_asc", page: 2, page_size: 20 });
  });

  it("writes filter changes back to the URL and resets the page", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } })));
    const history = await openList(scope, "/properties?page=3");
    await allSettled(districtToggled, { scope, params: "sergeli" });
    await allSettled(roomsToggled, { scope, params: "4" });
    expect(history.location.search).toContain("district=sergeli");
    expect(history.location.search).toContain("rooms=4");
    expect(history.location.search).not.toContain("page=3");
    expect(scope.getState($query).rooms).toEqual([4, 5, 6, 7, 8]);
    await allSettled(pageChanged, { scope, params: 2 });
    expect(history.location.search).toContain("page=2");
    await allSettled(filtersCleared, { scope });
    expect(history.location.search).toBe("");
    expect(scope.getState(routes.properties.$isOpened)).toBe(true);
  });

  it("leaves one history entry for a burst of typing, not one per keystroke", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.url.includes("/api/v1/properties")) calls.push(req.url);
      return new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const history = await openList(scope);
    const indexBefore = history.index;
    calls.length = 0; // opening the bare list fetched once already; count what the typing costs
    const type = scopeBind(searchChanged, { scope });
    type("c");
    type("ch");
    type("chi");
    await allSettled(searchChanged, { scope, params: "chil" });
    expect(history.index).toBe(indexBefore + 1);
    expect(history.location.search).toBe("?q=chil");
    // and the API is asked once, for the settled term
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("q=chil");
  });

  it("derives the page count from the total the API reports", async () => {
    const scope = fork();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], total: 45, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } })));
    expect(scope.getState($pageCount)).toBe(1);
    await allSettled(fetchPropertiesFx, { scope, params: { district: [], rooms: [], status: [], owner_only: false, removed: false, sort: "last_seen", page: 1, page_size: 20 } });
    expect(scope.getState($pageCount)).toBe(3);
  });

  it("clears the filter stores when the list route closes, so revisiting the bare list is not filtered by stale state", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.url.includes("/api/v1/properties")) calls.push(req.url);
      return new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const history = await openList(scope, "/properties?district=chilonzor");
    expect(scope.getState($district)).toBe("chilonzor");
    await allSettled(routes.property.navigate, { scope, params: { params: { id: "p1" }, query: {} } });
    calls.length = 0; // count only what the re-open costs
    await allSettled(routes.properties.navigate, { scope, params: { params: {}, query: {} } });
    expect(scope.getState($district)).toBe("");
    expect(history.location.search).toBe("");
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("district");
  });

  it("restores the filter stores from the URL when the back button returns to a filtered list", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } })));
    await openList(scope, "/properties?district=chilonzor&rooms=2");
    await allSettled(routes.property.navigate, { scope, params: { params: { id: "p1" }, query: {} } });
    expect(scope.getState($district)).toBe(""); // reset when the list closed
    await allSettled(controls.back, { scope });
    expect(scope.getState($district)).toBe("chilonzor");
    expect(scope.getState($rooms)).toBe("2");
  });

  it("sanitises malformed URL input before it reaches the API", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } })));
    await openList(scope, "/properties?rooms=abc,2&page=0&price_min=-5&price_max=300.5");
    const query = scope.getState($query);
    expect(query.rooms).toEqual([2]);
    expect(query.page).toBe(1);
    expect(query.price_min).toBeUndefined();
    expect(query.price_max).toBe(300);
  });

  it("toasts a translated error when the list request fails", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ title: "Server Error", status: 500, detail: "boom", code: "internal_error", type: "about:blank" }), { status: 500, headers: { "content-type": "application/problem+json" } }),
    ));
    await openList(scope);
    expect(toast.error).toHaveBeenCalledWith(i18n.t("errors.internal_error"));
  });

  it("does not fetch for an anonymous visitor before the auth guard redirects", async () => {
    const scope = fork({ values: [[$tokens, null]] });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.url.includes("/api/v1/properties")) calls.push(req.url);
      return new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const history = createMemoryHistory({ initialEntries: ["/properties"] });
    await allSettled(router.setHistory, { scope, params: history });
    await allSettled(sessionRestored, { scope, params: null });
    expect(calls).toHaveLength(0);
  });

  it("maps advanced filters into $query and counts them in $advancedCount", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } })));
    await openList(scope);
    await allSettled(areaChanged, { scope, params: { min: "40", max: "" } });
    await allSettled(buildingTypeToggled, { scope, params: "brick" });
    await allSettled(postedWithinChanged, { scope, params: "7d" });
    const query = scope.getState($query);
    expect(query.area_min).toBe(40);
    expect(query.area_max).toBeUndefined();
    expect(query.building_type).toEqual(["brick"]);
    expect(query.posted_within).toBe("7d");
    expect(scope.getState($advancedCount)).toBe(3);
  });

  it("resets only the advanced filters on advancedReset, leaving district and search intact", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }), { status: 200, headers: { "content-type": "application/json" } })));
    await openList(scope);
    await allSettled(districtToggled, { scope, params: "chilonzor" });
    await allSettled(searchChanged, { scope, params: "chil" });
    await allSettled(areaChanged, { scope, params: { min: "40", max: "80" } });
    await allSettled(floorChanged, { scope, params: { min: "2", max: "9" } });
    await allSettled(notFirstFloorToggled, { scope });
    await allSettled(notTopFloorToggled, { scope });
    await allSettled(buildingTypeToggled, { scope, params: "brick" });
    await allSettled(furnishedChanged, { scope, params: "1" });
    await allSettled(renovationToggled, { scope, params: "euro" });
    await allSettled(postedWithinChanged, { scope, params: "7d" });
    await allSettled(hasPhotosToggled, { scope });
    // all 11 advanced stores populated
    expect(scope.getState($advancedCount)).toBe(11);
    await allSettled(advancedReset, { scope });
    expect(scope.getState($advancedCount)).toBe(0);
    expect(scope.getState($query).building_type).toBeUndefined();
    expect(scope.getState($query).posted_within).toBeUndefined();
    expect(scope.getState($district)).toBe("chilonzor");
    expect(scope.getState($q)).toBe("chil");
  });
});
