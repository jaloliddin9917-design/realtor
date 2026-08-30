import { allSettled, fork, scopeBind } from "effector";
import { createMemoryHistory } from "history";
import { router, routes } from "@/shared/router";
import { $tokens, sessionRestored } from "@/entities/session";
import { fetchPropertiesFx } from "@/entities/property";
import { $pageCount, $query, districtToggled, filtersCleared, pageChanged, roomsToggled, searchChanged } from "./model";

async function openList(scope: ReturnType<typeof fork>, url = "/properties") {
  const history = createMemoryHistory({ initialEntries: [url] });
  await allSettled(router.setHistory, { scope, params: history });
  await allSettled(sessionRestored, { scope, params: { id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" } });
  return history;
}

describe("filters ↔ URL", () => {
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
});
