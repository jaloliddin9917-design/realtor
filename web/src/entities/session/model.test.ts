import { allSettled, fork } from "effector";
import { $isAdmin, $isAuthorized, $tokens, $user, loginFx, logout, restoreSessionFx } from "./model";
import { TOKEN_STORAGE_KEY } from "@/shared/config";

const user = { id: "u1", phone: "+998900000001", name: "Admin", role: "admin", locale: "uz" };

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
});
