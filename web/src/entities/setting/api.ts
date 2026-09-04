/**
 * Settings mock data for the sections that still have no backend (see entities/bot/api.ts for
 * the same note): bot channels and the rules/thresholds form. Field names follow the snake_case
 * the rest of the API client uses. The users list below is real (`GET /api/v1/users`); the
 * sources list is `entities/source`'s real `$sources`/`fetchSourcesFx` — nothing here mocks it.
 */
import { api, unwrap, type Schemas } from "@/shared/api";

export type UserRole = "admin" | "agent";

export interface SettingUser {
  id: string;
  name: string;
  role: UserRole;
  phone: string;
  active: boolean;
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

interface MockSettings {
  /** Test fixture only — production reads {@link fetchUsers}. Same 5 names/phones/roles as the
   * original mock; `active` replaces the old `bot_connected`/`presence` fields (see mapUser). */
  users: SettingUser[];
  bot_channels: BotChannelSetting[];
  rules: Rules;
}

export const MOCK_SETTINGS: MockSettings = {
  users: [
    { id: "u1", name: "Sardor", role: "admin", phone: "+998900001120", active: true },
    { id: "u2", name: "Aziz", role: "agent", phone: "+998901112233", active: true },
    { id: "u3", name: "Malika", role: "agent", phone: "+998912223344", active: true },
    { id: "u4", name: "Dilshod", role: "agent", phone: "+998933334455", active: false },
    { id: "u5", name: "Jasur", role: "agent", phone: "+998944445566", active: true },
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

// ---- real API ----
function mapUser(o: Schemas["AdminUserOut"]): SettingUser {
  return { id: o.id, name: o.name, role: o.role, phone: o.phone, active: o.active };
}

export function fetchUsers(): Promise<SettingUser[]> {
  return unwrap(api.GET("/api/v1/users")).then((rows) => rows.map(mapUser));
}

// TODO(real): PUT /api/v1/settings/rules — no backend endpoint yet, the rules section stays static
export function saveRules(rules: Rules): Promise<Rules> {
  return Promise.resolve(rules);
}

// TODO(real): POST /api/v1/users — no backend endpoint yet; appends locally so the dialog still works
export function addUser(input: { name: string; phone: string; role: UserRole }): Promise<SettingUser> {
  return Promise.resolve({ id: `u-${Date.now()}`, active: true, ...input });
}

// TODO(real): POST /api/v1/sources (kind: "telegram") — this screen only shows a static
// overview, so adding a channel here has nothing to append it to; it mocks the round trip.
export function addSourceChannel(_peer: string): Promise<void> {
  return Promise.resolve();
}
