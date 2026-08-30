import { api, configureAuth, unwrap } from "./client";
import { ApiProblem } from "./problem";

function jsonResponse(status: number, body: unknown, type = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": type } });
}

describe("api client", () => {
  const calls: Request[] = [];
  beforeEach(() => {
    calls.length = 0;
    configureAuth({ getAccess: () => "acc-1", refresh: async () => "acc-2" });
  });

  it("adds the bearer token", async () => {
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => { calls.push(req); return jsonResponse(200, { id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" }); }));
    const me = await unwrap(api.GET("/api/v1/me"));
    expect(me.name).toBe("A");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer acc-1");
  });

  it("refreshes once on 401 auth.token_expired and retries", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      calls.push(req); n += 1;
      if (n === 1) return jsonResponse(401, { title: "Unauthorized", status: 401, detail: "token expired", code: "auth.token_expired", type: "about:blank" }, "application/problem+json");
      return jsonResponse(200, { id: "u", phone: "+998900000001", name: "A", role: "agent", locale: "uz" });
    }));
    const me = await unwrap(api.GET("/api/v1/me"));
    expect(me.name).toBe("A");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer acc-2");
  });

  it("throws an ApiProblem for other errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(403, { title: "Forbidden", status: 403, detail: "admin role required", code: "auth.forbidden", type: "about:blank" }, "application/problem+json")));
    await expect(unwrap(api.GET("/api/v1/sources"))).rejects.toMatchObject({ code: "auth.forbidden", status: 403 } satisfies Partial<ApiProblem>);
  });
});
