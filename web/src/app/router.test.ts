import { allSettled, fork } from "effector";
import { createMemoryHistory } from "history";
import { $tokens, sessionRestored } from "@/entities/session";
import { router, routes } from "@/shared/router";
import { authorized } from "./router";

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
