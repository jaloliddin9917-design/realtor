import { allSettled, fork, scopeBind } from "effector";
import { createMemoryHistory } from "history";
import { $districts } from "@/entities/meta";
import { $detail } from "@/entities/property";
import { $sessionChecked, $tokens, sessionRestored } from "@/entities/session";
import { router, routes } from "@/shared/router";
import { authorized } from "./router";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const detailFor = (id: string) => ({ id, status: "new", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54, price_usd_min_minor: 45000, source_removed: false, needs_recheck: false, first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", listing_count: 1, source_kinds: ["olx"], probable_owner: null, photo_url: null, last_status_event: null, listings: [], status_events: [], duplicates: [] });

describe("auth guard", () => {
  it("sends an anonymous visitor from /properties to /login", async () => {
    const scope = fork({ values: [[$tokens, null]] });
    const history = createMemoryHistory({ initialEntries: ["/properties"] });
    await allSettled(router.setHistory, { scope, params: history });
    await allSettled(sessionRestored, { scope, params: null });
    expect(scope.getState(routes.login.$isOpened)).toBe(true);
    expect(scope.getState(authorized.properties.$isOpened)).toBe(false);
  });

  it("opens /properties for a restored session", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" }), { status: 200, headers: { "content-type": "application/json" } })));
    const history = createMemoryHistory({ initialEntries: ["/properties"] });
    await allSettled(router.setHistory, { scope, params: history });
    expect(scope.getState(authorized.properties.$isOpened)).toBe(true);
  });

  it("keeps agents out of /admin/sources", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" }), { status: 200, headers: { "content-type": "application/json" } })));
    const history = createMemoryHistory({ initialEntries: ["/admin/sources"] });
    await allSettled(router.setHistory, { scope, params: history });
    expect(scope.getState(authorized.adminSources.$isOpened)).toBe(false);
    expect(scope.getState(authorized.properties.$isOpened)).toBe(true);
    expect(history.location.pathname).toBe("/properties");
  });

  it("lets an admin into /admin/sources", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "u", phone: "+998900000001", name: "A", role: "admin", locale: "uz" }), { status: 200, headers: { "content-type": "application/json" } })));
    const history = createMemoryHistory({ initialEntries: ["/admin/sources"] });
    await allSettled(router.setHistory, { scope, params: history });
    expect(scope.getState(authorized.adminSources.$isOpened)).toBe(true);
  });

  it("sends a logged-in visitor from /login to the list", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" }), { status: 200, headers: { "content-type": "application/json" } })));
    const history = createMemoryHistory({ initialEntries: ["/login"] });
    await allSettled(router.setHistory, { scope, params: history });
    expect(scope.getState(routes.login.$isOpened)).toBe(false);
    expect(scope.getState(authorized.properties.$isOpened)).toBe(true);
  });

  it("loads the API's enumerations once per session, not once per page", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    let metaCalls = 0;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.url.includes("/api/v1/meta")) {
        metaCalls += 1;
        return json({ districts: ["chilonzor", "yunusobod"], statuses: ["new", "active", "inactive"], source_kinds: ["olx", "telegram", "manual"], contact_classifications: ["owner", "agent", "unknown"] });
      }
      if (req.url.includes("/api/v1/properties")) return json({ items: [], total: 0, page: 1, page_size: 20 });
      return json({ id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" });
    }));
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/properties"] }) });
    expect(metaCalls).toBe(1);
    expect(scope.getState($districts)).toEqual(["chilonzor", "yunusobod"]);
    await allSettled(routes.property.navigate, { scope, params: { params: { id: "p1" }, query: {} } });
    expect(scope.getState(authorized.property.$isOpened)).toBe(true);
    expect(metaCalls).toBe(1);
  });

  it("also loads meta on a deep link straight to /queue/:id — the call screen's fx line needs it without visiting /properties first", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    let metaCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.url.includes("/api/v1/meta")) {
        metaCalls += 1;
        return json({ districts: [], statuses: [], source_kinds: [], contact_classifications: [], fx: null, rules: { lock_hours: 4, recheck_days: 3, new_listing_check_days: 2, duplicate_merge_threshold: 0.75, telegram_per_hour: null, telegram_per_day: null, sms_per_day: null } });
      }
      return json({ id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" });
    }));
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/queue/1042"] }) });
    expect(scope.getState(authorized.call.$isOpened)).toBe(true);
    expect(metaCalls).toBe(1);
  });

  it("also loads meta on a deep link straight to /settings — the rules section needs it without visiting /admin/sources first", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    let metaCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.url.includes("/api/v1/meta")) {
        metaCalls += 1;
        return json({ districts: [], statuses: [], source_kinds: [], contact_classifications: [], fx: null, rules: { lock_hours: 4, recheck_days: 3, new_listing_check_days: 2, duplicate_merge_threshold: 0.75, telegram_per_hour: null, telegram_per_day: null, sms_per_day: null } });
      }
      if (req.url.includes("/api/v1/users")) return json([]);
      if (req.url.includes("/api/v1/sources")) return json({ items: [], fx: null });
      if (req.url.includes("/api/v1/bot")) return json({ channels: [], counters: { today: 0, queued: 0, answered: 0, unclear: 0, errors: 0 }, items: [] });
      return json({ id: "u", phone: "+998900000001", name: "A", role: "admin", locale: "uz" });
    }));
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/settings"] }) });
    expect(scope.getState(authorized.settings.$isOpened)).toBe(true);
    expect(metaCalls).toBe(1);
  });

  it("loads the property when /properties/:id opens and drops it when the route closes", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.url.includes("/api/v1/properties/p1")) return json({ id: "p1", status: "new", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54, price_usd_min_minor: 45000, source_removed: false, needs_recheck: false, first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", listing_count: 1, source_kinds: ["olx"], probable_owner: null, photo_url: null, last_status_event: null, listings: [], status_events: [], duplicates: [] });
      if (req.url.includes("/api/v1/properties")) return json({ items: [], total: 0, page: 1, page_size: 20 });
      if (req.url.includes("/api/v1/meta")) return json({ districts: [], statuses: [], source_kinds: [], contact_classifications: [] });
      return json({ id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" });
    }));
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/properties/p1"] }) });
    expect(scope.getState($detail)?.id).toBe("p1");
    await allSettled(routes.properties.navigate, { scope, params: { params: {}, query: {} } });
    expect(scope.getState(authorized.property.$isOpened)).toBe(false);
    expect(scope.getState($detail)).toBeNull();
  });

  it("ignores a stale property response once a different property is the open route", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }], [$sessionChecked, true]] });
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.url.includes("/api/v1/properties/p1")) {
        // p1 is requested first but answers last — the exact race the fix guards against
        await new Promise((r) => setTimeout(r, 15));
        return json(detailFor("p1"));
      }
      if (req.url.includes("/api/v1/properties/p2")) return json(detailFor("p2"));
      if (req.url.includes("/api/v1/meta")) return json({ districts: [], statuses: [], source_kinds: [], contact_classifications: [] });
      return json({ items: [], total: 0, page: 1, page_size: 20 });
    }));

    const setHistory = scopeBind(router.setHistory, { scope });
    const navigate = scopeBind(routes.property.navigate, { scope });
    const tick = () => new Promise((r) => setTimeout(r, 0));

    setHistory(createMemoryHistory({ initialEntries: ["/properties/p1"] }));
    await tick(); // let /properties/p1 open and its (slow) request start
    navigate({ params: { id: "p2" }, query: {} });
    await tick(); // let /properties/p2 open and its (fast) request start — both now in flight

    await new Promise((r) => setTimeout(r, 100)); // both requests settle; p1's stale answer lands last
    expect(scope.getState($detail)?.id).toBe("p2");
  });

  it("refetches on a params-only navigation and never shows the previous property under the new route", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    const propertyCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.url.includes("/api/v1/properties/p1")) { propertyCalls.push(req.url); return json(detailFor("p1")); }
      if (req.url.includes("/api/v1/properties/p2")) { propertyCalls.push(req.url); return json(detailFor("p2")); }
      if (req.url.includes("/api/v1/properties")) return json({ items: [], total: 0, page: 1, page_size: 20 });
      if (req.url.includes("/api/v1/meta")) return json({ districts: [], statuses: [], source_kinds: [], contact_classifications: [] });
      return json({ id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" });
    }));
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/properties/p1"] }) });
    expect(scope.getState($detail)?.id).toBe("p1");
    // same route, only the :id param changes — atomic-router fires `updated`, not `opened`
    await allSettled(routes.property.navigate, { scope, params: { params: { id: "p2" }, query: {} } });
    expect(scope.getState(authorized.property.$isOpened)).toBe(true);
    expect(scope.getState($detail)?.id).toBe("p2");
    expect(propertyCalls).toHaveLength(2);
  });

  // No `notFoundRoute` (see shared/router): an unknown path is redirected, address bar and all.
  it("sends an unknown path to the list", async () => {
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" }), { status: 200, headers: { "content-type": "application/json" } })));
    const history = createMemoryHistory({ initialEntries: ["/nowhere"] });
    await allSettled(router.setHistory, { scope, params: history });
    expect(history.location.pathname).toBe("/properties");
    expect(scope.getState(authorized.properties.$isOpened)).toBe(true);
  });
});
