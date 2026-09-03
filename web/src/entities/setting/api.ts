/**
 * Settings mock data. Shaped like the eventual API response — see `entities/bot/api.ts` for
 * the same note. Field names follow the snake_case the rest of the API client uses.
 */

export type UserRole = "admin" | "agent";
export type UserPresence = "plain" | "online_now" | "online";

export interface SettingUser {
  id: string;
  name: string;
  role: UserRole;
  phone: string;
  bot_connected: boolean;
  presence: UserPresence;
}

export type SourceFeedKind = "olx" | "telegram_channels" | "other_portal";

export interface SourceFeed {
  id: string;
  kind: SourceFeedKind;
  working: boolean;
  interval_minutes: number | null;
  last_checked_minutes_ago: number | null;
  added_today: number | null;
  /** Telegram channel handles/usernames; null for feed kinds that don't list them. */
  handles: string[] | null;
}

export type BotChannelSettingKind = "telegram" | "sms" | "voice";

export interface BotChannelSetting {
  id: string;
  kind: BotChannelSettingKind;
  /** Position in the outreach queue: Telegram first, SMS second, voice third. */
  priority: number;
  connected: boolean;
  account_phone: string | null;
  per_hour: number | null;
  per_day: number | null;
  sender: string | null;
}

export interface Rules {
  lock_hours: number;
  recheck_days: number;
  quiet_start: string; // "21:00"
  quiet_end: string; // "09:00"
  per_contact_count: number;
  per_contact_days: number;
  daily_limit_per_channel: number;
  new_listing_check_days: number;
  duplicate_threshold: number;
}

export interface SettingsOverview {
  users: SettingUser[];
  sources: SourceFeed[];
  bot_channels: BotChannelSetting[];
  rules: Rules;
}

export const MOCK_SETTINGS: SettingsOverview = {
  users: [
    { id: "u1", name: "Sardor", role: "admin", phone: "+998900001120", bot_connected: true, presence: "plain" },
    { id: "u2", name: "Aziz", role: "agent", phone: "+998901112233", bot_connected: true, presence: "online_now" },
    { id: "u3", name: "Malika", role: "agent", phone: "+998912223344", bot_connected: true, presence: "online" },
    { id: "u4", name: "Dilshod", role: "agent", phone: "+998933334455", bot_connected: false, presence: "plain" },
    { id: "u5", name: "Jasur", role: "agent", phone: "+998944445566", bot_connected: true, presence: "plain" },
  ],
  sources: [
    { id: "s1", kind: "olx", working: true, interval_minutes: 15, last_checked_minutes_ago: 12, added_today: 38, handles: null },
    { id: "s2", kind: "telegram_channels", working: true, interval_minutes: null, last_checked_minutes_ago: null, added_today: null, handles: ["@toshkent_ijara", "@ijara_uylar_tsh", "arenda_tashkent_kv", "@kvartira_tsh"] },
    { id: "s3", kind: "other_portal", working: false, interval_minutes: null, last_checked_minutes_ago: null, added_today: null, handles: null },
  ],
  bot_channels: [
    { id: "c1", kind: "telegram", priority: 1, connected: true, account_phone: "+998900001122", per_hour: 12, per_day: 100, sender: null },
    { id: "c2", kind: "sms", priority: 2, connected: true, account_phone: null, per_hour: null, per_day: null, sender: "REALTOR" },
    { id: "c3", kind: "voice", priority: 3, connected: false, account_phone: null, per_hour: null, per_day: null, sender: null },
  ],
  rules: {
    lock_hours: 4,
    recheck_days: 3,
    quiet_start: "21:00",
    quiet_end: "09:00",
    per_contact_count: 1,
    per_contact_days: 7,
    daily_limit_per_channel: 100,
    new_listing_check_days: 2,
    duplicate_threshold: 0.75,
  },
};

// TODO(real): GET /api/v1/settings/overview
export function fetchSettingsOverview(): Promise<SettingsOverview> {
  return Promise.resolve(MOCK_SETTINGS);
}

// TODO(real): PUT /api/v1/settings/rules
export function saveRules(rules: Rules): Promise<Rules> {
  return Promise.resolve(rules);
}

// TODO(real): POST /api/v1/settings/users
export function addUser(input: { name: string; phone: string; role: UserRole }): Promise<SettingUser> {
  return Promise.resolve({ id: `u-${Date.now()}`, bot_connected: false, presence: "plain", ...input });
}

// TODO(real): POST /api/v1/sources (kind: "telegram") — this screen only shows a static
// overview, so adding a channel here has nothing to append it to; it mocks the round trip.
export function addSourceChannel(_peer: string): Promise<void> {
  return Promise.resolve();
}
