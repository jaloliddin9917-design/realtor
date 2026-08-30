import { allSettled, fork } from "effector";
import { $sources } from "@/entities/source";
import { $addError, $peerError, addRequested } from "./model";

function problem(status: number, code: string, errors?: unknown[]): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: "x", status, detail: "x", code, errors }), { status, headers: { "content-type": "application/problem+json" } });
}

describe("add telegram source", () => {
  it("adds the created source to the list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "s2", kind: "telegram", name: "@uy_ijara", enabled: true, interval_seconds: 900, status: "ok", last_run_at: null, next_run_at: null, paused_until: null, consecutive_failures: 0, config: {}, last_run: null }), { status: 201, headers: { "content-type": "application/json" } })));
    const scope = fork({ values: [[$sources, []]] });
    await allSettled(addRequested, { scope, params: { peer: "@uy_ijara", interval_seconds: 900 } });
    expect(scope.getState($sources).map((s) => s.name)).toEqual(["@uy_ijara"]);
    expect(scope.getState($addError)).toBeNull();
  });
  it("maps peer_unresolved to the peer field and other codes to the form error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => problem(422, "source.peer_unresolved", [{ loc: ["body", "peer"], msg: "cannot resolve", type: "value_error" }])));
    const scope = fork();
    await allSettled(addRequested, { scope, params: { peer: "@nope", interval_seconds: 900 } });
    expect(scope.getState($peerError)).toBe("errors.source.peer_unresolved");
    vi.stubGlobal("fetch", vi.fn(async () => problem(503, "source.login_required")));
    await allSettled(addRequested, { scope, params: { peer: "@x", interval_seconds: 900 } });
    expect(scope.getState($addError)).toBe("errors.source.login_required");
  });
});
