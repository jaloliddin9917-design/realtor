/**
 * Bot Monitor mock data. Shaped like the eventual API response so the swap to a real
 * backend later is a one-line change in `fetchBotOverview` — nothing in `model.ts` or the
 * page needs to know the difference. Field names follow the snake_case the rest of the API
 * client uses (see `entities/property/api.ts`, `entities/source/api.ts`).
 */

export type BotChannelKind = "telegram" | "sms";

/** «1» → vacant, «2» → taken, free text → unclear, no reply → waiting, not sent yet → queued. */
export type OutreachResult = "vacant" | "taken" | "unclear" | "waiting" | "queued";

export interface ChannelStat {
  channel: BotChannelKind;
  sent_today: number;
  daily_limit: number;
  per_hour: number;
  /** The team account's number for Telegram; null for SMS (it goes through a provider, not an account). */
  account_phone: string | null;
  /** Local time-of-day (HH:MM) the per-hour throttle opens back up; null when nothing is waiting. */
  wait_until: string | null;
}

export interface QuietHoursStat {
  can_send_now: boolean;
  start: string; // "21:00"
  end: string; // "09:00"
}

export interface DoNotContactStat {
  /** Local time-of-day (HH:MM) of the most recent STOP reply, always today for this mock. */
  last_stop_time: string;
  window_days: number;
  max_per_window: number;
}

export interface OutreachCounters {
  today: number;
  queued: number;
  replied: number;
  unclear: number;
  errors: number;
}

export interface OutreachRow {
  id: string;
  district: string;
  street: string;
  rooms: number;
  price_usd_minor: number;
  /** null renders as "taqsimlanmagan" — no agent assigned yet. */
  agent: string | null;
  phone: string;
  channel: BotChannelKind;
  /** Local time-of-day (HH:MM) the outreach message went out; null when still queued. */
  sent_at: string | null;
  /** The contact's raw reply text ("1", "2", or free text) — real inbound content, not UI copy. */
  reply_text: string | null;
  replied_at: string | null;
  /** Hours since sending with no reply yet — only set while `result` is "waiting". */
  no_reply_hours: number | null;
  follow_up_time: string | null;
  follow_up_agent: string | null;
  result: OutreachResult;
}

export interface BotOverview {
  channels: ChannelStat[];
  quiet_hours: QuietHoursStat;
  do_not_contact: DoNotContactStat;
  counters: OutreachCounters;
  rows: OutreachRow[];
}

export const MOCK_BOT_OVERVIEW: BotOverview = {
  channels: [
    { channel: "telegram", sent_today: 61, daily_limit: 100, per_hour: 12, account_phone: "+998900001122", wait_until: "14:50" },
    { channel: "sms", sent_today: 35, daily_limit: 100, per_hour: 12, account_phone: null, wait_until: null },
  ],
  quiet_hours: { can_send_now: true, start: "21:00", end: "09:00" },
  do_not_contact: { last_stop_time: "13:12", window_days: 7, max_per_window: 1 },
  counters: { today: 96, queued: 27, replied: 41, unclear: 3, errors: 2 },
  rows: [
    { id: "o1", district: "chilonzor", street: "Qatortol", rooms: 2, price_usd_minor: 45000, agent: "Aziz", phone: "+998908112437", channel: "telegram", sent_at: "12:31", reply_text: "1", replied_at: "12:40", no_reply_hours: null, follow_up_time: null, follow_up_agent: null, result: "vacant" },
    { id: "o2", district: "yakkasaroy", street: "Bobur", rooms: 2, price_usd_minor: 52000, agent: null, phone: "+998912339014", channel: "sms", sent_at: "10:50", reply_text: "2", replied_at: "11:05", no_reply_hours: null, follow_up_time: null, follow_up_agent: null, result: "taken" },
    { id: "o3", district: "olmazor", street: "Qorasaroy", rooms: 2, price_usd_minor: 40000, agent: "Jasur", phone: "+998996407721", channel: "telegram", sent_at: "12:35", reply_text: "hozircha bor, lekin 420 ga", replied_at: "13:02", no_reply_hours: null, follow_up_time: null, follow_up_agent: null, result: "unclear" },
    { id: "o4", district: "mirobod", street: "Oybek", rooms: 3, price_usd_minor: 70000, agent: "Dilshod", phone: "+998977156002", channel: "sms", sent_at: "09:15", reply_text: null, replied_at: null, no_reply_hours: 5, follow_up_time: "17:00", follow_up_agent: "Dilshod", result: "waiting" },
    { id: "o5", district: "bektemir", street: "Tolariq", rooms: 1, price_usd_minor: 25000, agent: null, phone: "+998905553108", channel: "telegram", sent_at: null, reply_text: null, replied_at: null, no_reply_hours: null, follow_up_time: null, follow_up_agent: null, result: "queued" },
  ],
};

// TODO(real): GET /api/v1/bot/overview
export function fetchBotOverview(): Promise<BotOverview> {
  return Promise.resolve(MOCK_BOT_OVERVIEW);
}
