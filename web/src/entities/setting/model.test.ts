import { allSettled, fork } from "effector";
import { toast } from "sonner";
import { i18n } from "@/shared/i18n";
import { $users, fetchUsersFx } from "./model";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("fetchUsersFx", () => {
  it("fills $users from GET /api/v1/users, mapping active honestly (no bot/presence backend)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([
      { id: "u1", name: "Sardor", phone: "+998900001120", role: "admin", active: true, created_at: "2026-01-01T00:00:00Z" },
      { id: "u4", name: "Dilshod", phone: "+998933334455", role: "agent", active: false, created_at: "2026-01-01T00:00:00Z" },
    ])));
    const scope = fork();
    await allSettled(fetchUsersFx, { scope });
    expect(scope.getState($users)).toEqual([
      { id: "u1", name: "Sardor", phone: "+998900001120", role: "admin", active: true },
      { id: "u4", name: "Dilshod", phone: "+998933334455", role: "agent", active: false },
    ]);
  });
});

describe("users fetch errors", () => {
  it("toasts a translated error when the users request fails", async () => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ type: "about:blank", title: "x", status: 403, detail: "x", code: "auth.forbidden" }), { status: 403, headers: { "content-type": "application/problem+json" } }),
    ));
    const scope = fork();
    await allSettled(fetchUsersFx, { scope });
    expect(toast.error).toHaveBeenCalledWith(i18n.t("errors.auth.forbidden"));
  });
});
