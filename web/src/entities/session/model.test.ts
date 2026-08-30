import { allSettled, createWatch, fork } from "effector";
import {
  $isAdmin, $isAuthorized, $sessionChecked, $tokens, $user,
  loadTokens, loginFx, logout, restoreSessionFx, sessionRestored, tokensLoaded, type User,
} from "./model";
import { TOKEN_STORAGE_KEY } from "@/shared/config";

const user = { id: "u1", phone: "+998900000001", name: "Admin", role: "admin", locale: "uz" };
const tokenExpired = { title: "Unauthorized", status: 401, detail: "token expired", code: "auth.token_expired", type: "about:blank" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("session", () => {
  beforeEach(() => localStorage.clear());

  it("logs in, stores tokens, loads the user", async () => {
    vi.stubGlobal("fetch", vi.fn(async (req: Request) =>
      req.url.endsWith("/auth/login") ? jsonResponse(200, { access: "a", refresh: "r", token_type: "bearer" }) : jsonResponse(200, user)));
    const scope = fork();
    await allSettled(loginFx, { scope, params: { phone: "+998900000001", password: "secret1" } });
    expect(scope.getState($tokens)).toEqual({ access: "a", refresh: "r" });
    expect(scope.getState($user)?.name).toBe("Admin");
    expect(scope.getState($isAuthorized)).toBe(true);
    expect(scope.getState($isAdmin)).toBe(true);
    expect(JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) ?? "null")).toEqual({ access: "a", refresh: "r" });
  });

  it("restores a session from storage and clears it on logout", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ access: "a", refresh: "r" }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, user)));
    const scope = fork({ values: [[$tokens, { access: "a", refresh: "r" }]] });
    await allSettled(restoreSessionFx, { scope });
    expect(scope.getState($user)?.id).toBe("u1");
    await allSettled(logout, { scope });
    expect(scope.getState($tokens)).toBeNull();
    expect(scope.getState($isAuthorized)).toBe(false);
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("clears tokens that came from storage on logout", async () => {
    // What production does on every reload: storage already holds tokens when the model
    // loads. They must not become the store's default — `logout` has to end at null.
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ access: "stale", refresh: "stale-r" }));
    vi.stubGlobal("fetch", vi.fn(async (req: Request) =>
      req.url.endsWith("/auth/login") ? jsonResponse(200, { access: "a", refresh: "r", token_type: "bearer" }) : jsonResponse(200, user)));
    const scope = fork();
    await allSettled(tokensLoaded, { scope, params: loadTokens() });
    expect(scope.getState($tokens)).toEqual({ access: "stale", refresh: "stale-r" });
    await allSettled(loginFx, { scope, params: { phone: "+998900000001", password: "secret1" } });
    expect(scope.getState($tokens)).toEqual({ access: "a", refresh: "r" });
    await allSettled(logout, { scope });
    expect(scope.getState($tokens)).toBeNull();
    expect(scope.getState($isAuthorized)).toBe(false);
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("checks the session without a request when the scope holds no tokens", async () => {
    // Storage is deliberately non-empty: `restoreSessionFx` must read `$tokens` from its
    // own scope, not the module-global storage.
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ access: "stale", refresh: "stale-r" }));
    const fetchStub = vi.fn(async () => jsonResponse(200, user));
    vi.stubGlobal("fetch", fetchStub);
    const scope = fork();
    const restored: (User | null)[] = [];
    createWatch({ unit: sessionRestored, scope, fn: (u) => { restored.push(u); } });
    await allSettled(restoreSessionFx, { scope });
    expect(fetchStub).not.toHaveBeenCalled();
    expect(restored).toEqual([null]);
    expect(scope.getState($sessionChecked)).toBe(true);
    expect(scope.getState($user)).toBeNull();
  });

  it("logs out instead of recursing when the refresh token is expired too", async () => {
    const tokens = { access: "a", refresh: "r" };
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
    const fetchStub = vi.fn(async () => jsonResponse(401, tokenExpired));
    vi.stubGlobal("fetch", fetchStub);
    const scope = fork();
    await allSettled(tokensLoaded, { scope, params: tokens });
    await allSettled(restoreSessionFx, { scope });
    // GET /me, then POST /auth/refresh — the expired refresh token answers with the same
    // 401 auth.token_expired, and refreshing again would never terminate.
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(scope.getState($user)).toBeNull();
    expect(scope.getState($tokens)).toBeNull();
    expect(scope.getState($isAuthorized)).toBe(false);
    expect(scope.getState($sessionChecked)).toBe(true);
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});
