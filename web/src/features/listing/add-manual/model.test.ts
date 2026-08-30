import { allSettled, fork } from "effector";
import { createMemoryHistory } from "history";
import { router, routes } from "@/shared/router";
import { $urlError, addUrlRequested } from "./model";

describe("add listing by url", () => {
  it("navigates to the created property", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ property_id: "p7", listing_id: "l7", created: true, decision: "new" }), { status: 201, headers: { "content-type": "application/json" } })));
    const scope = fork();
    // `routes.property.navigate` only reaches $params through an actual history push
    // (see app/router.test.ts for the same pattern), so the scope needs a history to push into.
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/properties"] }) });
    await allSettled(addUrlRequested, { scope, params: "https://www.olx.uz/d/obyavlenie/x-ID7.html" });
    expect(scope.getState(routes.property.$params)).toEqual({ id: "p7" });
    expect(scope.getState($urlError)).toBeNull();
  });
  it("shows the translated problem for a bad link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ type: "about:blank", title: "x", status: 422, detail: "x", code: "listing.unsupported_url", errors: [] }), { status: 422, headers: { "content-type": "application/problem+json" } })));
    const scope = fork();
    await allSettled(addUrlRequested, { scope, params: "https://example.com/x" });
    expect(scope.getState($urlError)).toBe("errors.listing.unsupported_url");
  });
});
