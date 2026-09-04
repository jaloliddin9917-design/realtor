import { allSettled, fork } from "effector";
import { toast } from "sonner";
import { $rows, fetchBotFx, type OutreachRow } from "@/entities/bot";
import { ApiProblem } from "@/shared/api";
import { i18n } from "@/shared/i18n";
import { resolveFx, resolveRequested } from "./model";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = (over: Partial<OutreachRow> = {}): OutreachRow => ({
  id: "o3", propertyId: "pr-o3", district: "olmazor", rooms: 2, priceUsdMinor: 40000, phone: "+998996407721",
  channel: "telegram", sentAt: new Date().toISOString(), replyText: "hozircha bor, lekin 420 ga", repliedAt: new Date().toISOString(),
  noReplyHours: null, result: "unclear", ...over,
});

describe("resolveRequested", () => {
  it("resolves the reply through resolveFx, swaps the updated row into $rows, and toasts success", async () => {
    vi.mocked(toast.success).mockClear();
    const resolved = row({ result: "vacant" });
    const scope = fork({
      values: [[$rows, [row()]]],
      handlers: [[resolveFx, async () => resolved]],
    });
    await allSettled(resolveRequested, { scope, params: { id: "o3", result: "vacant" } });
    expect(scope.getState($rows)).toEqual([resolved]);
    expect(toast.success).toHaveBeenCalledWith(i18n.t("bot.resolvedToast"));
  });

  it("toasts an error and refetches the monitor on a 409 outreach.not_resolvable race", async () => {
    vi.mocked(toast.error).mockClear();
    let refetched = false;
    const scope = fork({
      values: [[$rows, [row()]]],
      handlers: [
        [resolveFx, async () => { throw new ApiProblem(409, "outreach.not_resolvable", "message is not awaiting manual classification"); }],
        [fetchBotFx, async () => { refetched = true; return { channels: [], counters: { today: 0, queued: 0, replied: 0, unclear: 0, errors: 0 }, rows: [] }; }],
      ],
    });
    await allSettled(resolveRequested, { scope, params: { id: "o3", result: "vacant" } });
    expect(toast.error).toHaveBeenCalled();
    expect(refetched).toBe(true);
    // the refetch resyncs $rows from the server rather than leaving the stale local row behind
    expect(scope.getState($rows)).toEqual([]);
  });
});
