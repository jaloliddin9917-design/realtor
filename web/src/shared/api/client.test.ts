import { api, configureAuth, unwrap } from "./client";
import { ApiProblem } from "./problem";

const me = { id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" };
const tokenExpired = { title: "Unauthorized", status: 401, detail: "token expired", code: "auth.token_expired", type: "about:blank" };

function jsonResponse(status: number, body: unknown, type = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": type } });
}

/**
 * Reads a request body the way a real `fetch` does — by consuming it. `request.clone()`
 * leaves the original undisturbed, so a stub that peeks through a clone would let a
 * middleware rebuild the *sent* request and hide the bug the retry test is about.
 */
async function takeJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  return raw ? JSON.parse(raw) : null;
}

describe("api client", () => {
  const calls: Request[] = [];
  beforeEach(() => {
    calls.length = 0;
    configureAuth({ getAccess: () => "acc-1", refresh: async () => "acc-2" });
  });

  it("adds the bearer token", async () => {
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => { calls.push(req); return jsonResponse(200, me); }));
    const user = await unwrap(api.GET("/api/v1/me"));
    expect(user.name).toBe("A");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer acc-1");
  });

  it("refreshes once on 401 auth.token_expired and retries", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      calls.push(req); n += 1;
      if (n === 1) return jsonResponse(401, tokenExpired, "application/problem+json");
      return jsonResponse(200, me);
    }));
    const user = await unwrap(api.GET("/api/v1/me"));
    expect(user.name).toBe("A");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer acc-2");
  });

  it("replays a request with a body after a refresh", async () => {
    const bodies: unknown[] = [];
    const statusEvent = { id: 1, actor_id: "u", actor_type: "user", created_at: "2026-08-30T09:00:00Z", from_status: "new", note: null, to_status: "active" };
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      calls.push(req);
      bodies.push(await takeJsonBody(req));
      n += 1;
      if (n === 1) return jsonResponse(401, tokenExpired, "application/problem+json");
      return jsonResponse(200, statusEvent);
    }));
    const event = await unwrap(api.POST("/api/v1/properties/{property_id}/status", {
      params: { path: { property_id: "p1" } },
      body: { status: "active", note: null },
    }));
    expect(event.to_status).toBe("active");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer acc-2");
    expect(bodies[1]).toEqual({ status: "active", note: null });
  });

  it("shares a single refresh between concurrent 401s", async () => {
    let refreshes = 0;
    configureAuth({
      getAccess: () => "acc-1",
      refresh: async () => { refreshes += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return "acc-2"; },
    });
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      calls.push(req); n += 1;
      return n <= 2 ? jsonResponse(401, tokenExpired, "application/problem+json") : jsonResponse(200, me);
    }));
    const [first, second] = await Promise.all([unwrap(api.GET("/api/v1/me")), unwrap(api.GET("/api/v1/me"))]);
    expect(refreshes).toBe(1);
    expect(first.name).toBe("A");
    expect(second.name).toBe("A");
    expect(calls).toHaveLength(4);
    expect(calls[2]?.headers.get("authorization")).toBe("Bearer acc-2");
    expect(calls[3]?.headers.get("authorization")).toBe("Bearer acc-2");
  });

  it("resolves an empty successful body as undefined", async () => {
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => { calls.push(req); return new Response(null, { status: 204 }); }));
    await expect(unwrap(api.GET("/api/v1/me"))).resolves.toBeUndefined();
  });

  it("throws an ApiProblem for other errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(403, { title: "Forbidden", status: 403, detail: "admin role required", code: "auth.forbidden", type: "about:blank" }, "application/problem+json")));
    await expect(unwrap(api.GET("/api/v1/sources"))).rejects.toMatchObject({ code: "auth.forbidden", status: 403 } satisfies Partial<ApiProblem>);
  });
});
