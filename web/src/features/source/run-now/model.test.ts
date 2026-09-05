import { allSettled, fork } from "effector";
import { $sources, type Source } from "@/entities/source";
import { runFx, runRequested } from "./model";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const src = { id: "s1", kind: "olx", name: "olx-x", enabled: true, interval_seconds: 900, status: "ok", last_run_at: null, next_run_at: "2026-09-05T10:00:00Z", paused_until: null, consecutive_failures: 0, config: { url: "https://www.olx.uz/x/" }, last_run: null } as unknown as Source;

describe("run-now", () => {
  it("requests a crawl and reflects the rescheduled source in the table", async () => {
    const rescheduled = { ...src, next_run_at: "2026-09-05T11:11:11Z" };
    const scope = fork({ values: [[$sources, [src]]], handlers: [[runFx, async () => rescheduled]] });
    await allSettled(runRequested, { scope, params: "s1" });
    expect(scope.getState($sources)[0]?.next_run_at).toBe("2026-09-05T11:11:11Z");
  });
});
