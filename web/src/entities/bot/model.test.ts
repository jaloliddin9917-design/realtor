import { allSettled, fork } from "effector";
import { toast } from "sonner";
import { i18n } from "@/shared/i18n";
import { $channels, $counters, $rows, fetchBotFx } from "./model";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const HOUR = 3_600_000;
/** An ISO timestamp `n` hours before "now", computed at call time so the expectation doesn't drift. */
const hoursAgo = (n: number) => new Date(Date.now() - n * HOUR).toISOString();

const raw = {
  channels: [
    { channel: "telegram", enabled: false, status: "not_configured", sent_today: 3, per_hour: 12, per_day: 100 },
    { channel: "sms", enabled: false, status: "not_configured", sent_today: 1, per_hour: null, per_day: 100 },
  ],
  counters: { today: 5, queued: 1, answered: 3, unclear: 1, errors: 1 },
  items: [
    // not sent yet
    { id: "i1", property_id: "p1", district: "chilonzor", rooms: 2, price_usd: 450, phone: "+998908112437", channel: "telegram", status: "queued", sent_at: null, reply_text: null, reply_at: null, result: null },
    // sent, no reply yet — nulls throughout also exercise district/rooms/price/phone fallbacks
    { id: "i2", property_id: "p2", district: null, rooms: null, price_usd: null, phone: null, channel: "sms", status: "sent", sent_at: hoursAgo(3), reply_text: null, reply_at: null, result: null },
    // answered and classified
    { id: "i3", property_id: "p3", district: "mirobod", rooms: 3, price_usd: 700, phone: "+998977156002", channel: "telegram", status: "answered", sent_at: hoursAgo(2), reply_text: "1", reply_at: hoursAgo(1), result: "vacant" },
    // answered but not yet classified — defensive "unclear" fallback, not a crash
    { id: "i4", property_id: "p4", district: "olmazor", rooms: 2, price_usd: 400, phone: "+998996407721", channel: "telegram", status: "answered", sent_at: hoursAgo(1), reply_text: "hozircha bor", reply_at: hoursAgo(0.5), result: null },
    // the send itself failed
    { id: "i5", property_id: "p5", district: "sergeli", rooms: 1, price_usd: 260, phone: null, channel: "sms", status: "error", sent_at: null, reply_text: null, reply_at: null, result: null },
  ],
};

describe("fetchBotFx", () => {
  it("maps channels, counters and items (snake_case wire -> camelCase view model)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(raw)));
    const scope = fork();
    const result = await allSettled(fetchBotFx, { scope });
    expect(result.status).toBe("done");

    expect(scope.getState($channels)).toEqual([
      { channel: "telegram", enabled: false, status: "not_configured", sentToday: 3, perHour: 12, perDay: 100 },
      { channel: "sms", enabled: false, status: "not_configured", sentToday: 1, perHour: null, perDay: 100 },
    ]);
    // answered -> replied (see the mapping comment in api.ts)
    expect(scope.getState($counters)).toEqual({ today: 5, queued: 1, replied: 3, unclear: 1, errors: 1 });

    const rows = scope.getState($rows);
    expect(rows[0]).toEqual({
      id: "i1", propertyId: "p1", district: "chilonzor", rooms: 2, priceUsdMinor: 45000, phone: "+998908112437",
      channel: "telegram", sentAt: null, replyText: null, repliedAt: null, noReplyHours: null, result: "queued",
    });
    // i2: every nullable field falls back (district "", rooms 0, priceUsdMinor null, phone ""),
    // and a "sent" status with still no reply derives noReplyHours from sent_at rather than
    // fabricating a follow-up schedule the API has no field for
    expect(rows[1]).toMatchObject({ district: "", rooms: 0, priceUsdMinor: null, phone: "", result: "waiting", noReplyHours: 3 });
    expect(rows[2]).toMatchObject({ result: "vacant", priceUsdMinor: 70000 });
    expect(rows[3]).toMatchObject({ result: "unclear", noReplyHours: null });
    expect(rows[4]).toMatchObject({ result: "error", noReplyHours: null, phone: "" });
  });
});

describe("bot fetch errors", () => {
  it("toasts a translated error when the bot monitor request fails", async () => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ type: "about:blank", title: "x", status: 500, detail: "x", code: "internal_error" }), { status: 500, headers: { "content-type": "application/problem+json" } }),
    ));
    const scope = fork();
    await allSettled(fetchBotFx, { scope });
    expect(toast.error).toHaveBeenCalledWith(i18n.t("errors.internal_error"));
  });
});
