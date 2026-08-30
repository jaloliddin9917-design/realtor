import { allSettled, fork } from "effector";
import { $sources, type Source } from "@/entities/source";
import { toggleRequested } from "./model";

const src = { id: "s1", kind: "telegram", name: "@chan", enabled: true, interval_seconds: 900, status: "ok", last_run_at: null, next_run_at: null, paused_until: null, consecutive_failures: 0, config: { peer: "@chan" }, last_run: null } as Source;

describe("source toggle", () => {
  it("patches and updates the store", async () => {
    const reqs: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => { reqs.push({ method: req.method, url: req.url, body: await req.json() }); return new Response(JSON.stringify({ ...src, enabled: false }), { status: 200, headers: { "content-type": "application/json" } }); }));
    const scope = fork({ values: [[$sources, [src]]] });
    await allSettled(toggleRequested, { scope, params: { id: "s1", enabled: false } });
    expect(reqs[0]).toMatchObject({ method: "PATCH", body: { enabled: false } });
    expect(reqs[0]?.url).toContain("/api/v1/sources/s1");
    expect(scope.getState($sources)[0]?.enabled).toBe(false);
  });
});
