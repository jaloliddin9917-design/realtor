import { allSettled, fork } from "effector";
import { toast } from "sonner";
import { i18n } from "@/shared/i18n";
import { $meta, loadMetaFx } from "./model";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("loadMetaFx", () => {
  it("carries the real fx snapshot and rule constants through onto $meta, untouched", async () => {
    const raw = {
      districts: ["chilonzor"], statuses: ["new", "active", "inactive"], source_kinds: ["olx", "telegram", "manual"], contact_classifications: ["owner", "agent", "unknown"],
      fx: { date: "2026-09-04", usd_uzs: "12500.00", fetched_at: "2026-09-04T03:00:00Z", stale: false },
      rules: { lock_hours: 4, recheck_days: 3, new_listing_check_days: 2, duplicate_merge_threshold: 0.75, telegram_per_hour: 12, telegram_per_day: 100, sms_per_day: 100 },
    };
    vi.stubGlobal("fetch", vi.fn(async () => json(raw)));
    const scope = fork();
    await allSettled(loadMetaFx, { scope });
    expect(scope.getState($meta)?.fx).toEqual(raw.fx);
    expect(scope.getState($meta)?.rules).toEqual(raw.rules);
  });

  it("carries a null fx through as-is (the backend hasn't fetched a rate yet)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ districts: [], statuses: [], source_kinds: [], contact_classifications: [], fx: null, rules: { lock_hours: 4, recheck_days: 3, new_listing_check_days: 2, duplicate_merge_threshold: 0.75, telegram_per_hour: null, telegram_per_day: null, sms_per_day: null } })));
    const scope = fork();
    await allSettled(loadMetaFx, { scope });
    expect(scope.getState($meta)?.fx).toBeNull();
  });
});

describe("meta load errors", () => {
  it("toasts a translated error when the meta request fails", async () => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ type: "about:blank", title: "x", status: 500, detail: "x", code: "internal_error" }), { status: 500, headers: { "content-type": "application/problem+json" } }),
    ));
    const scope = fork();
    await allSettled(loadMetaFx, { scope });
    expect(toast.error).toHaveBeenCalledWith(i18n.t("errors.internal_error"));
  });
});
